package com.jackie.dungeon.sync

import com.jackie.dungeon.story.ChoiceRow
import com.jackie.dungeon.story.CharacterRow
import com.jackie.dungeon.story.EffectRow
import com.jackie.dungeon.story.FightMoveRow
import com.jackie.dungeon.story.FightOutcomeRow
import com.jackie.dungeon.story.FightRoundRow
import com.jackie.dungeon.story.FightRow
import com.jackie.dungeon.story.GateRow
import com.jackie.dungeon.story.LineRow
import com.jackie.dungeon.story.NodeRow
import com.jackie.dungeon.story.StateVarRow
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRow
import com.jackie.dungeon.story.StoryRows
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Two people editing one story at once, merged rather than overwritten.
 *
 * Each phone keeps the story as it was at its last sync (the BASE). At the
 * next sync it compares base, its own copy and the cloud's, row by row and
 * field by field:
 *   - a field only one side changed takes that side's value — so one person
 *     renaming a scene and the other rewriting its script keeps both;
 *   - a row one side added, or deleted, is added or deleted;
 *   - only when both changed the SAME field of the same row does the newer
 *     edit win (deleting a row beats editing it).
 * Then anything left pointing at a row that's gone is tidied away, the way
 * the database's own cascades would.
 */
object Merge {

    data class Result(val rows: StoryRows, val conflicts: Int)

    private val json = StoryRows.json

    private class Table<T>(val name: String, val ser: KSerializer<T>, val get: (StoryRows) -> List<T>, val id: (T) -> String)

    private val TABLES: List<Table<*>> = listOf(
        Table("nodes", NodeRow.serializer(), { it.nodes }, { it.id }),
        Table("state_vars", StateVarRow.serializer(), { it.stateVars }, { it.id }),
        Table("characters", CharacterRow.serializer(), { it.characters }, { it.id }),
        Table("choices", ChoiceRow.serializer(), { it.choices }, { it.id }),
        Table("gates", GateRow.serializer(), { it.gates }, { it.id }),
        Table("effects", EffectRow.serializer(), { it.effects }, { it.id }),
        Table("dialogue_lines", LineRow.serializer(), { it.dialogueLines }, { it.id }),
        Table("fights", FightRow.serializer(), { it.fights }, { it.id }),
        Table("fight_moves", FightMoveRow.serializer(), { it.fightMoves }, { it.id }),
        Table("fight_rounds", FightRoundRow.serializer(), { it.fightRounds }, { it.id }),
        Table("fight_round_outcomes", FightOutcomeRow.serializer(), { it.fightRoundOutcomes }, { it.id }),
    )

    @Suppress("UNCHECKED_CAST")
    private fun <T> objects(t: Table<T>, r: StoryRows): LinkedHashMap<String, JsonObject> {
        val out = LinkedHashMap<String, JsonObject>()
        for (row in t.get(r)) out[t.id(row)] = json.encodeToJsonElement(t.ser, row).jsonObject
        return out
    }

    /**
     * [localWins] settles a field both sides changed: true when this phone's
     * edit is the newer one.
     */
    fun merge(base: StoryRows, local: StoryRows, remote: StoryRows, localWins: Boolean): Result {
        var conflicts = 0
        fun field(b: JsonElement?, l: JsonElement?, r: JsonElement?): JsonElement? = when {
            l == r -> l
            l == b -> r
            r == b -> l
            else -> { conflicts++; if (localWins) l else r }
        }
        fun row(b: JsonObject?, l: JsonObject, r: JsonObject): JsonObject {
            val keys = LinkedHashSet<String>().apply { addAll(l.keys); addAll(r.keys) }
            return JsonObject(keys.associateWith { k -> field(b?.get(k), l[k], r[k]) ?: JsonNull })
        }

        val story = row(enc(StoryRow.serializer(), base.story), enc(StoryRow.serializer(), local.story), enc(StoryRow.serializer(), remote.story))
        val merged = HashMap<String, List<JsonObject>>()
        for (t0 in TABLES) {
            @Suppress("UNCHECKED_CAST") val t = t0 as Table<Any?>
            val b = objects(t, base); val l = objects(t, local); val r = objects(t, remote)
            // Order: as the base had them, then what each side added — the order
            // items were created decides their bit in the engine.
            val ids = LinkedHashSet<String>().apply { addAll(b.keys); addAll(l.keys); addAll(r.keys) }
            val out = ArrayList<JsonObject>()
            for (id in ids) {
                val bo = b[id]; val lo = l[id]; val ro = r[id]
                when {
                    bo == null && lo != null && ro != null -> out += row(null, lo, ro)
                    bo == null -> (lo ?: ro)?.let(out::add)
                    lo == null || ro == null -> {
                        // Deleted on one side: gone, even if the other side edited it —
                        // an edit to a scene someone removed can't be put anywhere.
                        if ((lo ?: ro) != bo) conflicts++
                    }
                    else -> out += row(bo, lo, ro)
                }
            }
            merged[t.name] = out
        }
        val rows = StoryRows(
            story = json.decodeFromJsonElement(StoryRow.serializer(), story),
            nodes = dec(merged["nodes"]!!, NodeRow.serializer()),
            stateVars = dec(merged["state_vars"]!!, StateVarRow.serializer()),
            characters = dec(merged["characters"]!!, CharacterRow.serializer()),
            choices = dec(merged["choices"]!!, ChoiceRow.serializer()),
            gates = dec(merged["gates"]!!, GateRow.serializer()),
            effects = dec(merged["effects"]!!, EffectRow.serializer()),
            dialogueLines = dec(merged["dialogue_lines"]!!, LineRow.serializer()),
            fights = dec(merged["fights"]!!, FightRow.serializer()),
            fightMoves = dec(merged["fight_moves"]!!, FightMoveRow.serializer()),
            fightRounds = dec(merged["fight_rounds"]!!, FightRoundRow.serializer()),
            fightRoundOutcomes = dec(merged["fight_round_outcomes"]!!, FightOutcomeRow.serializer()),
        )
        return Result(tidy(rows), conflicts)
    }

    private fun <T> enc(s: KSerializer<T>, v: T) = json.encodeToJsonElement(s, v).jsonObject
    private fun <T> dec(l: List<JsonObject>, s: KSerializer<T>): List<T> = l.map { json.decodeFromJsonElement(s, it) }

    /**
     * After a merge, nothing may point at a row that's gone, and the database's
     * unique rules must still hold — the cloud would refuse the push otherwise.
     * One person deleted a scene while the other added a door out of it: the
     * door goes. Both made a scene called the same: the second is renamed.
     */
    fun tidy(r: StoryRows): StoryRows {
        val nodes = r.nodes.map { it.id }.toSet()
        fun node(id: String?) = id?.takeIf { it in nodes }
        // Slugs unique per story: the later of two equal slugs gets a fresh one.
        fun <T> unslug(list: List<T>, slug: (T) -> String, re: (T, String) -> T): List<T> {
            val seen = HashSet<String>()
            return list.map { x -> val s0 = slug(x); if (seen.add(s0.uppercase())) x else { val s1 = StoryEditor.uniqueSlug(s0, seen); seen += s1; re(x, s1) } }
        }
        val ns = unslug(r.nodes.map { it.copy(timeoutTargetId = node(it.timeoutTargetId), invalidTargetId = node(it.invalidTargetId)) }, { it.slug }, { n, s -> n.copy(slug = s) })
        val vars = unslug(r.stateVars, { it.slug }, { v, s -> v.copy(slug = s) })
        val chars = unslug(r.characters, { it.slug }, { c, s -> c.copy(slug = s) })
        val choices = r.choices.filter { it.fromNodeId in nodes }.map { it.copy(toNodeId = node(it.toNodeId)) }
        val choiceIds = choices.map { it.id }.toSet()
        val gates = r.gates.filter { it.choiceId in choiceIds }.distinctBy { it.choiceId }.map { it.copy(failNodeId = node(it.failNodeId)) }
        val varIds = vars.map { it.id }.toSet()
        val effects = r.effects.filter { it.stateVarId in varIds && (it.nodeId in nodes || it.choiceId in choiceIds) }
        val charIds = chars.map { it.id }.toSet()
        val lines = r.dialogueLines.filter { it.nodeId in nodes || it.choiceId in choiceIds }.map { if (it.characterId != null && it.characterId !in charIds) it.copy(characterId = null) else it }
        val fights = r.fights.filter { it.nodeId in nodes }.distinctBy { it.nodeId }.map { it.copy(winNodeId = node(it.winNodeId), loseNodeId = node(it.loseNodeId)) }
        val fightIds = fights.map { it.id }.toSet()
        val moves = r.fightMoves.filter { it.fightId in fightIds }
        val rounds = r.fightRounds.filter { it.fightId in fightIds }
        val moveIds = moves.map { it.id }.toSet(); val roundIds = rounds.map { it.id }.toSet()
        val outcomes = r.fightRoundOutcomes.filter { it.fightId in fightIds && it.moveId in moveIds && it.roundId in roundIds }
            .distinctBy { it.roundId to it.moveId }.map { it.copy(toNodeId = node(it.toNodeId)) }
        val root = node(r.story.rootNodeId) ?: ns.firstOrNull()?.id
        return r.copy(story = r.story.copy(rootNodeId = root), nodes = ns, stateVars = vars, characters = chars, choices = choices, gates = gates,
            effects = effects, dialogueLines = lines, fights = fights, fightMoves = moves, fightRounds = rounds, fightRoundOutcomes = outcomes)
    }

    /** What to send so the cloud's copy becomes [target]: rows to upsert, ids to delete, by table. */
    data class Diff(val upserts: Map<String, List<String>>, val deletes: Map<String, List<String>>, val storyChanged: Boolean) {
        val empty get() = !storyChanged && upserts.values.all { it.isEmpty() } && deletes.values.all { it.isEmpty() }
    }

    fun diff(from: StoryRows, target: StoryRows): Diff {
        val up = HashMap<String, List<String>>(); val del = HashMap<String, List<String>>()
        for (t0 in TABLES) {
            @Suppress("UNCHECKED_CAST") val t = t0 as Table<Any?>
            val a = objects(t, from); val b = objects(t, target)
            up[t.name] = b.filter { (id, o) -> a[id] != o }.keys.toList()
            del[t.name] = a.keys.filter { it !in b }
        }
        return Diff(up, del, enc(StoryRow.serializer(), from.story) != enc(StoryRow.serializer(), target.story))
    }
}
