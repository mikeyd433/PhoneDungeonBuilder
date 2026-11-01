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
import com.jackie.dungeon.story.StoryRow
import com.jackie.dungeon.story.StoryRows
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.time.Instant

/**
 * A story as the cloud's tables hold it, and back. The phone's rows already
 * have the tables' shapes (snake_case, same columns), so this mostly adds
 * what the phone leaves implicit — `story_id` on every row, the owner, a
 * creation order — and leaves alone the columns only the web app uses
 * (a room's design, a character's figure), which an upsert keeps.
 */
object CloudRows {

    /** Parents before children: the order rows are written. Deletes go the other way. */
    val TABLES = listOf(
        "nodes", "state_vars", "characters", "choices", "gates", "effects",
        "dialogue_lines", "fights", "fight_moves", "fight_rounds", "fight_round_outcomes",
    )

    private val json = StoryRows.json

    private fun <T> encode(s: KSerializer<T>, v: T): JsonObject = json.encodeToJsonElement(s, v).jsonObject

    /**
     * Every child row, by table, ready to upsert. [orderBase] is the instant
     * the first row is stamped with; each next row one millisecond later, so
     * reading back by `created_at` returns them in the phone's order (item bit
     * positions and tie-breaks follow it).
     */
    fun rows(r: StoryRows, orderBase: Instant): Map<String, List<JsonObject>> {
        var tick = 0L
        fun stamp(o: JsonObject): JsonObject = JsonObject(o + mapOf(
            "story_id" to JsonPrimitive(r.story.id),
            "created_at" to JsonPrimitive(orderBase.plusMillis(tick++).toString()),
        ))
        // A fork whose far side was deleted has nowhere to send a caller: the
        // cloud refuses a divert with no target, so it goes up as a refusal.
        val gates = r.gates.map { if (it.failBehavior == "divert" && it.failNodeId == null) it.copy(failBehavior = "refuse") else it }
        return linkedMapOf(
            "nodes" to r.nodes.map { stamp(encode(NodeRow.serializer(), it.copy(status = it.status ?: "stub"))) },
            "state_vars" to r.stateVars.map { stamp(encode(StateVarRow.serializer(), it)) },
            "characters" to r.characters.map { stamp(encode(CharacterRow.serializer(), it.copy(name = it.name.ifBlank { "Someone" }))) },
            "choices" to r.choices.map { stamp(encode(ChoiceRow.serializer(), it)) },
            "gates" to gates.map { stamp(encode(GateRow.serializer(), it)) },
            "effects" to r.effects.map { stamp(encode(EffectRow.serializer(), it)) },
            "dialogue_lines" to r.dialogueLines.map { stamp(encode(LineRow.serializer(), it)) },
            "fights" to r.fights.map { stamp(encode(FightRow.serializer(), it)) },
            "fight_moves" to r.fightMoves.map { stamp(encode(FightMoveRow.serializer(), it)) },
            "fight_rounds" to r.fightRounds.map { stamp(encode(FightRoundRow.serializer(), it)) },
            "fight_round_outcomes" to r.fightRoundOutcomes.map { stamp(encode(FightOutcomeRow.serializer(), it)) },
        )
    }

    /** The stories row. Without the entrance at first: it may not exist in the cloud yet. */
    fun storyRow(r: StoryRows, ownerId: String?, withRoot: Boolean): JsonObject {
        val o = encode(StoryRow.serializer(), r.story.copy(title = r.story.title.ifBlank { "Untitled story" })).toMutableMap()
        if (!withRoot) o.remove("root_node_id")
        if (ownerId != null) o["owner_id"] = JsonPrimitive(ownerId)
        return JsonObject(o)
    }

    /** A story read back from the tables. */
    fun story(story: JsonObject, tables: Map<String, JsonArray>): StoryRows {
        fun <T> list(t: String, s: KSerializer<T>): List<T> = json.decodeFromJsonElement(ListSerializer(s), tables[t] ?: JsonArray(emptyList()))
        // The cloud stores "no entrance yet" and empty layouts as nulls in places the phone keeps empty values.
        val st = JsonObject(story.filterValues { it !is JsonNull } )
        return StoryRows(
            story = json.decodeFromJsonElement(StoryRow.serializer(), st),
            nodes = list("nodes", NodeRow.serializer()),
            choices = list("choices", ChoiceRow.serializer()),
            stateVars = list("state_vars", StateVarRow.serializer()),
            effects = list("effects", EffectRow.serializer()),
            gates = list("gates", GateRow.serializer()),
            characters = list("characters", CharacterRow.serializer()),
            dialogueLines = list("dialogue_lines", LineRow.serializer()),
            fights = list("fights", FightRow.serializer()),
            fightMoves = list("fight_moves", FightMoveRow.serializer()),
            fightRounds = list("fight_rounds", FightRoundRow.serializer()),
            fightRoundOutcomes = list("fight_round_outcomes", FightOutcomeRow.serializer()),
        )
    }
}
