package com.jackie.dungeon.story

import com.jackie.dungeon.engine.Expression
import java.text.Normalizer
import java.util.UUID

/**
 * Every edit the phone can make to a story, as pure functions from rows to
 * rows. No Android, so each one is tested on the JVM (`StoryEditorTest`), and
 * undo is just the previous value.
 *
 * The rules are the web app's, carried over where they bite:
 *   - a door's KEY is the caller's digit; the first free one is offered;
 *   - deleting a scene never leaves a door, fork or timeout pointing at nothing;
 *   - narration and its speaker lines are one thing seen twice (principle 8):
 *     editing the script regenerates the lines, keeping any take whose line
 *     didn't change;
 *   - a fork is a `divert` gate, a refusal is a `refuse` gate.
 */
object StoryEditor {
    val KEYS = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0")

    fun newId(): String = UUID.randomUUID().toString()

    // ---- naming -----------------------------------------------------------------

    /** `slugify` from src/lib/slug.ts. */
    fun slugify(title: String): String {
        val base = Normalizer.normalize(title, Normalizer.Form.NFKD)
            .replace(Regex("[\\u0300-\\u036f]"), "")
            .uppercase()
            .replace(Regex("[^A-Z0-9]+"), "_")
            .trim('_')
            .take(48)
            .trimEnd('_')
        if (base.isEmpty()) return "ROOM"
        return if (base[0].isDigit()) "N_$base" else base
    }

    fun uniqueSlug(desired: String, taken: Collection<String>): String {
        val used = taken.map { it.uppercase() }.toSet()
        val base = slugify(desired)
        if (base !in used) return base
        var n = 2
        while ("${base}_$n" in used) n++
        return "${base}_$n"
    }

    // ---- stories ----------------------------------------------------------------

    fun newStory(title: String): StoryRows {
        val start = NodeRow(id = newId(), slug = "START", title = "The beginning", narration = "")
        return StoryRows(story = StoryRow(id = newId(), title = title, rootNodeId = start.id), nodes = listOf(start))
    }

    fun setStoryTitle(r: StoryRows, title: String) = r.copy(story = r.story.copy(title = title))

    fun setEntrance(r: StoryRows, nodeId: String) = r.copy(story = r.story.copy(rootNodeId = nodeId))

    // ---- scenes -----------------------------------------------------------------

    fun addScene(r: StoryRows, title: String = "", chapter: String? = null): Pair<StoryRows, String> {
        val id = newId()
        val slug = uniqueSlug(title.ifBlank { "Scene" }, r.nodes.map { it.slug })
        return r.copy(nodes = r.nodes + NodeRow(id = id, slug = slug, title = title, chapter = chapter)) to id
    }

    fun updateScene(
        r: StoryRows, id: String,
        title: String? = null, chapter: String? = null, clearChapter: Boolean = false,
        /** "room", "death" or "win". */
        kind: String? = null,
    ): StoryRows = r.copy(nodes = r.nodes.map { n ->
        if (n.id != id) n else n.copy(
            title = title ?: n.title,
            chapter = if (clearChapter) null else chapter ?: n.chapter,
            nodeType = when (kind) { null -> n.nodeType; "room" -> "room"; else -> "ending" },
            endingKind = when (kind) { null -> n.endingKind; "room" -> null; else -> kind },
        )
    })

    /** The scene's script. If it is already split into speaker lines, the lines follow. */
    fun setScript(r: StoryRows, nodeId: String, narration: String): StoryRows {
        val withText = r.copy(nodes = r.nodes.map { if (it.id == nodeId) it.copy(narration = narration) else it })
        return if (withText.dialogueLines.any { it.nodeId == nodeId }) resplit(withText, narration, nodeId = nodeId) else withText
    }

    /** What is heard between pressing a door's key and the next scene. Blank removes it. */
    fun setReply(r: StoryRows, choiceId: String, text: String?): StoryRows {
        val value = text?.takeIf { it.isNotBlank() }
        val withText = r.copy(choices = r.choices.map { if (it.id == choiceId) it.copy(reactionNarration = value) else it })
        if (value == null) return withText.copy(dialogueLines = withText.dialogueLines.filter { it.choiceId != choiceId })
        return if (withText.dialogueLines.any { it.choiceId == choiceId }) resplit(withText, value, choiceId = choiceId) else withText
    }

    /**
     * Split a script into speaker lines (the cast and recording-by-line both
     * need them). Characters are matched by name or slug, and made if new.
     */
    fun splitIntoLines(r: StoryRows, nodeId: String? = null, choiceId: String? = null): StoryRows {
        val text = if (nodeId != null) r.nodes.first { it.id == nodeId }.narration
        else r.choices.first { it.id == choiceId }.reactionNarration ?: ""
        return resplit(r, text, nodeId, choiceId)
    }

    private fun resplit(r: StoryRows, text: String, nodeId: String? = null, choiceId: String? = null): StoryRows {
        val mine = { l: LineRow -> if (nodeId != null) l.nodeId == nodeId else l.choiceId == choiceId }
        val old = r.dialogueLines.filter(mine).sortedBy { it.sortOrder }
        var characters = r.characters
        fun characterFor(name: String?): String? {
            if (name == null) return null
            val needle = name.trim().lowercase()
            characters.firstOrNull { it.name.lowercase() == needle || it.slug.lowercase() == needle }?.let { return it.id }
            val c = CharacterRow(id = newId(), slug = uniqueSlug(name, characters.map { it.slug }), name = name.trim())
            characters = characters + c
            return c.id
        }
        val fresh = Dialogue.split(text).mapIndexed { i, s ->
            val who = characterFor(s.speaker)
            val same = old.getOrNull(i)?.takeIf { it.text == s.text && it.characterId == who }
            same?.copy(sortOrder = i) ?: LineRow(id = newId(), nodeId = nodeId, choiceId = choiceId, characterId = who, text = s.text, sortOrder = i)
        }
        return r.copy(characters = characters, dialogueLines = r.dialogueLines.filterNot(mine) + fresh)
    }

    // ---- chapters ---------------------------------------------------------------

    /** Every chapter in the story, in the order scenes were made. */
    fun chapters(r: StoryRows): List<String> = r.nodes.mapNotNull { it.chapter?.takeIf { c -> c.isNotBlank() } }.distinct()

    /** Put scenes in a chapter (blank takes them out of any). */
    fun setChapter(r: StoryRows, ids: Set<String>, chapter: String?) =
        r.copy(nodes = r.nodes.map { if (it.id in ids) it.copy(chapter = chapter?.trim()?.takeIf { c -> c.isNotEmpty() }) else it })

    fun renameChapter(r: StoryRows, from: String, to: String) =
        r.copy(nodes = r.nodes.map { if (it.chapter == from) it.copy(chapter = to.trim().takeIf { c -> c.isNotEmpty() }) else it })

    /**
     * A scene and everything that can ONLY be reached through it — its branch.
     * Mike's intro and everything that is Mike's alone, but not a scene Carter's
     * path also leads into. (The scenes it dominates, in graph terms.)
     */
    fun branchOf(r: StoryRows, start: String): Set<String> {
        fun next(id: String) = r.choices.filter { it.fromNodeId == id }.flatMap { c ->
            listOfNotNull(c.toNodeId, r.gates.firstOrNull { g -> g.choiceId == c.id && g.failBehavior == "divert" }?.failNodeId)
        }
        val known = r.nodes.map { it.id }.toSet()
        // Everything reachable from the entrance without passing through [start]…
        val outside = HashSet<String>()
        val root = r.story.rootNodeId
        if (root != null && root != start) {
            val stack = ArrayDeque(listOf(root))
            while (stack.isNotEmpty()) {
                val u = stack.removeLast()
                if (u == start || u !in known || !outside.add(u)) continue
                next(u).forEach(stack::addLast)
            }
        }
        // …so the branch is what's reachable from it and not from there.
        val branch = LinkedHashSet<String>()
        val stack = ArrayDeque(listOf(start))
        while (stack.isNotEmpty()) {
            val u = stack.removeLast()
            if (u !in known || u in outside || !branch.add(u)) continue
            next(u).forEach(stack::addLast)
        }
        return branch
    }

    /** Remove a scene and everything that hangs off it; nothing is left pointing at it. */
    fun deleteScene(r: StoryRows, id: String): StoryRows {
        require(id != r.story.rootNodeId) { "The entrance can't be deleted. Make another scene the entrance first." }
        val doors = r.choices.filter { it.fromNodeId == id }.map { it.id }.toSet()
        val fights = r.fights.filter { it.nodeId == id }.map { it.id }.toSet()
        return r.copy(
            nodes = r.nodes.filter { it.id != id }.map {
                it.copy(
                    invalidTargetId = it.invalidTargetId.takeIf { t -> t != id },
                    timeoutTargetId = it.timeoutTargetId.takeIf { t -> t != id },
                )
            },
            choices = r.choices.filter { it.id !in doors }.map { if (it.toNodeId == id) it.copy(toNodeId = null) else it },
            effects = r.effects.filter { it.nodeId != id && it.choiceId !in doors },
            gates = r.gates.filter { it.choiceId !in doors }.map { if (it.failNodeId == id) it.copy(failNodeId = null) else it },
            dialogueLines = r.dialogueLines.filter { it.nodeId != id && it.choiceId !in doors },
            fights = r.fights.filter { it.id !in fights }.map {
                it.copy(winNodeId = it.winNodeId.takeIf { t -> t != id }, loseNodeId = it.loseNodeId.takeIf { t -> t != id })
            },
            fightMoves = r.fightMoves.filter { it.fightId !in fights },
            fightRounds = r.fightRounds.filter { it.fightId !in fights },
            fightRoundOutcomes = r.fightRoundOutcomes.filter { it.fightId !in fights }
                .map { if (it.toNodeId == id) it.copy(toNodeId = null) else it },
        )
    }

    // ---- choices ----------------------------------------------------------------

    fun freeKey(r: StoryRows, from: String, except: String? = null): String? {
        val used = r.choices.filter { it.fromNodeId == from && it.id != except }.map { it.digit }.toSet()
        return KEYS.firstOrNull { it !in used }
    }

    /**
     * A new door out of [from]. [to] is a scene id, or null for "nowhere yet".
     * With [newScene], a fresh scene is made behind it, in the same chapter.
     */
    fun addChoice(r: StoryRows, from: String, label: String = "", to: String? = null, newScene: Boolean = false): Pair<StoryRows, String> {
        val key = freeKey(r, from) ?: error("Every key in this scene is taken.")
        var rows = r
        var target = to
        if (newScene) {
            val chapter = r.nodes.firstOrNull { it.id == from }?.chapter
            val (next, id) = addScene(rows, label, chapter)
            rows = next; target = id
        }
        val id = newId()
        val c = ChoiceRow(id = id, fromNodeId = from, digit = key, label = label, toNodeId = target, sortOrder = key.toInt().let { if (it == 0) 10 else it })
        return rows.copy(choices = rows.choices + c) to id
    }

    fun updateChoice(r: StoryRows, id: String, label: String? = null, digit: String? = null, to: String? = null, clearTo: Boolean = false): StoryRows =
        r.copy(choices = r.choices.map { c ->
            if (c.id != id) c else c.copy(
                label = label ?: c.label,
                digit = digit ?: c.digit,
                sortOrder = digit?.toIntOrNull()?.let { if (it == 0) 10 else it } ?: c.sortOrder,
                toNodeId = if (clearTo) null else to ?: c.toNodeId,
            )
        })

    fun deleteChoice(r: StoryRows, id: String) = r.copy(
        choices = r.choices.filter { it.id != id },
        effects = r.effects.filter { it.choiceId != id },
        gates = r.gates.filter { it.choiceId != id },
        dialogueLines = r.dialogueLines.filter { it.choiceId != id },
    )

    // ---- takes ------------------------------------------------------------------

    /**
     * Where a take can go. One function per kind of slot, all the same shape:
     * a path to an 8 kHz WAV (or null to clear it) and how long it runs.
     * Takes are never deleted here — undo has to be able to bring one back.
     */
    fun setSceneTake(r: StoryRows, nodeId: String, path: String?, ms: Int? = null) =
        r.copy(nodes = r.nodes.map { if (it.id == nodeId) it.copy(audioPath = path, audioDurationMs = if (path == null) null else ms) else it })

    fun setReplyTake(r: StoryRows, choiceId: String, path: String?, ms: Int? = null) =
        r.copy(choices = r.choices.map { if (it.id == choiceId) it.copy(audioPath = path, audioDurationMs = if (path == null) null else ms) else it })

    fun setRefusalTake(r: StoryRows, choiceId: String, path: String?) =
        r.copy(gates = r.gates.map { if (it.choiceId == choiceId) it.copy(failAudioPath = path) else it })

    fun setLineTake(r: StoryRows, lineId: String, path: String?, ms: Int? = null) =
        r.copy(dialogueLines = r.dialogueLines.map { if (it.id == lineId) it.copy(audioPath = path, audioDurationMs = if (path == null) null else ms) else it })

    /** [which] is "name" (the readback), "gain" or "spend". */
    fun setItemTake(r: StoryRows, varId: String, which: String, path: String?) =
        r.copy(stateVars = r.stateVars.map { v ->
            if (v.id != varId) v else when (which) {
                "gain" -> v.copy(gainAudioPath = path)
                "spend" -> v.copy(spendAudioPath = path)
                else -> v.copy(audioPath = path)
            }
        })

    // ---- items ------------------------------------------------------------------

    fun addItem(r: StoryRows, name: String, kind: String = "item"): Pair<StoryRows, StateVarRow> {
        val v = StateVarRow(id = newId(), slug = uniqueSlug(name.ifBlank { "Item" }, r.stateVars.map { it.slug }), name = name, kind = kind)
        return r.copy(stateVars = r.stateVars + v) to v
    }

    fun updateItem(r: StoryRows, id: String, name: String? = null, gain: String? = null, spend: String? = null, consumable: Boolean? = null) =
        r.copy(stateVars = r.stateVars.map { v ->
            if (v.id != id) v else v.copy(
                name = name ?: v.name,
                gainNarration = gain ?: v.gainNarration,
                spendNarration = spend ?: v.spendNarration,
                isConsumable = consumable ?: v.isConsumable,
            )
        })

    /** The item a door GIVES (one, for the phone's editor). Null gives nothing. */
    fun setGives(r: StoryRows, choiceId: String, varId: String?): StoryRows {
        val rest = r.effects.filterNot { it.choiceId == choiceId && it.operation == "grant" }
        if (varId == null) return r.copy(effects = rest)
        return r.copy(effects = rest + EffectRow(id = newId(), choiceId = choiceId, stateVarId = varId, operation = "grant"))
    }

    fun gives(r: StoryRows, choiceId: String): StateVarRow? =
        r.effects.firstOrNull { it.choiceId == choiceId && it.operation == "grant" }?.let { e -> r.stateVars.firstOrNull { it.id == e.stateVarId } }

    /**
     * What a door REQUIRES. [mode] is "refuse" (stay here and hear [failLine])
     * or "divert" (a fork: without it, go to [failNode]). Null [varSlug] removes
     * the condition.
     */
    fun setRequires(r: StoryRows, choiceId: String, varSlug: String?, mode: String = "refuse", failLine: String? = null, failNode: String? = null): StoryRows {
        val rest = r.gates.filterNot { it.choiceId == choiceId }
        if (varSlug == null) return r.copy(gates = rest)
        val old = r.gates.firstOrNull { it.choiceId == choiceId }
        val g = GateRow(
            id = old?.id ?: newId(),
            choiceId = choiceId,
            expression = Expression.Has(varSlug),
            failBehavior = mode,
            failNarration = if (mode == "refuse") failLine?.takeIf { it.isNotBlank() } else null,
            failAudioPath = if (mode == "refuse") old?.failAudioPath else null,
            failNodeId = if (mode == "divert") failNode else null,
            consumeOnPass = old?.consumeOnPass ?: false,
        )
        // Keep its place, so an edit doesn't reorder anything else.
        return if (old == null) r.copy(gates = rest + g) else r.copy(gates = r.gates.map { if (it.choiceId == choiceId) g else it })
    }

    /** A condition the phone's simple editor can show and change: one "has". */
    fun simpleRequirement(r: StoryRows, choiceId: String): String? =
        (r.gates.firstOrNull { it.choiceId == choiceId }?.expression as? Expression.Has)?.v

    /** Any condition at all, in words — including ones written on the web app. */
    fun describe(e: Expression?): String = when (e) {
        null -> ""
        is Expression.Has -> "has ${e.v}"
        is Expression.Lacks -> "lacks ${e.v}"
        is Expression.Gte -> "${e.v} ≥ ${e.value}"
        is Expression.Lte -> "${e.v} ≤ ${e.value}"
        is Expression.Eq -> "${e.v} = ${e.value}"
        is Expression.And -> if (e.args.isEmpty()) "always" else e.args.joinToString(" and ") { describe(it) }
        is Expression.Or -> e.args.joinToString(" or ") { describe(it) }
        is Expression.Not -> "not (${describe(e.arg)})"
        is Expression.Unknown -> e.op
    }
}
