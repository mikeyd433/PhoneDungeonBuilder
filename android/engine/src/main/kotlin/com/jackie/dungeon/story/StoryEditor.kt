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
    fun chapters(r: StoryRows): List<String> = r.nodes.flatMap { n ->
        val p = FlowLayout.chapterPath(n.chapter)
        (1..p.size).map { p.take(it).joinToString("/") }
    }.distinct().let { all -> all.filter { !it.contains('/') }.flatMap { top -> listOf(top) + all.filter { it.startsWith("$top/") } } }

    /** Is this scene in [chapter], directly or in one of its sub-chapters? */
    fun inChapter(n: NodeRow, chapter: String): Boolean {
        val p = FlowLayout.chapterPath(n.chapter).joinToString("/")
        return p == chapter || p.startsWith("$chapter/")
    }

    /** How a chapter path reads: "Mike › Path A". */
    fun chapterLabel(chapter: String) = FlowLayout.chapterPath(chapter).joinToString(" › ")

    /** Put scenes in a chapter (blank takes them out of any). */
    fun setChapter(r: StoryRows, ids: Set<String>, chapter: String?) =
        r.copy(nodes = r.nodes.map { if (it.id in ids) it.copy(chapter = chapter?.trim()?.takeIf { c -> c.isNotEmpty() }) else it })

    /** Rename a chapter, or move it (its sub-chapters, scenes and hand-made moves go with it). Blank removes it. */
    fun renameChapter(r: StoryRows, from: String, to: String): StoryRows {
        val name = FlowLayout.chapterPath(to).joinToString("/").takeIf { it.isNotEmpty() }
        fun re(k: String): String? = when {
            k == from -> name
            k.startsWith("$from/") -> name?.let { it + k.removePrefix(from) } ?: k.removePrefix("$from/")
            else -> k
        }
        val lanes = r.story.laneNudges.entries.mapNotNull { (k, v) -> re(k)?.let { it to v } }.toMap()
        val home = r.story.layoutHome.entries.mapNotNull { (k, v) -> if (!k.startsWith("chapter:")) k to v else re(k.removePrefix("chapter:"))?.let { "chapter:$it" to v } }.toMap()
        return r.copy(story = r.story.copy(laneNudges = lanes, layoutHome = home), nodes = r.nodes.map { n ->
            val p = FlowLayout.chapterPath(n.chapter).joinToString("/")
            if (p == from || p.startsWith("$from/")) n.copy(chapter = re(p)) else n
        })
    }

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

    // ---- moving things on the flowchart -----------------------------------------

    /**
     * Move a box by hand. The layout still decides where everything goes; this
     * is an offset from that, so a scene added later doesn't land on top of it
     * and RESET LAYOUT can always take it back.
     */
    fun nudgeScene(r: StoryRows, id: String, dx: Float, dy: Float) =
        r.copy(nodes = r.nodes.map { if (it.id == id) it.copy(nudgeX = it.nudgeX + dx, nudgeY = it.nudgeY + dy) else it })

    /** Move a whole chapter's lane, every scene in it together. */
    fun nudgeChapter(r: StoryRows, chapter: String, dx: Float, dy: Float): StoryRows {
        val (x, y) = r.story.laneNudges[chapter]?.let { (it.getOrElse(0) { 0f }) to (it.getOrElse(1) { 0f }) } ?: (0f to 0f)
        return r.copy(story = r.story.copy(laneNudges = r.story.laneNudges + (chapter to listOf(x + dx, y + dy))))
    }

    /** Every hand-made move, as "<scene id>" / "chapter:<name>" -> [dx, dy]; only the ones that move anything. */
    fun currentLayout(r: StoryRows): Map<String, List<Float>> {
        val out = LinkedHashMap<String, List<Float>>()
        for ((k, v) in r.story.laneNudges) if (v.any { it != 0f }) out["chapter:$k"] = v
        for (n in r.nodes) if (n.nudgeX != 0f || n.nudgeY != 0f) out[n.id] = listOf(n.nudgeX, n.nudgeY)
        return out
    }

    /** Put the layout to [home]'s moves exactly (empty for the automatic layout). */
    private fun applyLayout(r: StoryRows, home: Map<String, List<Float>>) = r.copy(
        story = r.story.copy(laneNudges = home.filterKeys { it.startsWith("chapter:") }.mapKeys { it.key.removePrefix("chapter:") }),
        nodes = r.nodes.map { n ->
            val h = home[n.id]
            val x = h?.getOrNull(0) ?: 0f; val y = h?.getOrNull(1) ?: 0f
            if (n.nudgeX == x && n.nudgeY == y) n else n.copy(nudgeX = x, nudgeY = y)
        },
    )

    /** Make the arrangement on screen now the one RESET LAYOUT comes back to. */
    fun saveLayoutAsDefault(r: StoryRows) = r.copy(story = r.story.copy(layoutHome = currentLayout(r)))

    /** Back to the saved default arrangement (or the automatic one, if none was saved). */
    fun resetLayout(r: StoryRows) = applyLayout(r, r.story.layoutHome)

    /** Forget every move and the saved default: back to the layout the app works out. */
    fun autoLayout(r: StoryRows) = applyLayout(r.copy(story = r.story.copy(layoutHome = emptyMap())), emptyMap())

    /** Has anything moved since the default was saved? */
    fun layoutChanged(r: StoryRows) = currentLayout(r) != r.story.layoutHome

    fun hasNudges(r: StoryRows) = currentLayout(r).isNotEmpty()

    /** Remove a scene and everything that hangs off it; nothing is left pointing at it. */
    /** Where a scene's choices lead (forks included), not counting back to itself: where its callers would go next. */
    fun onward(r: StoryRows, id: String): List<String> {
        val known = r.nodes.map { it.id }.toSet()
        return FlowLayout.doorsOf(r, id)
            .flatMap { c -> listOfNotNull(c.toNodeId, r.gates.firstOrNull { it.choiceId == c.id && it.failBehavior == "divert" }?.failNodeId) }
            .filter { it != id && it in known }.distinct()
    }

    /** The choices (and forks) from OTHER scenes that lead into this one. */
    fun into(r: StoryRows, id: String): List<ChoiceRow> {
        val viaFork = r.gates.filter { it.failNodeId == id }.map { it.choiceId }.toSet()
        return r.choices.filter { (it.toNodeId == id || it.id in viaFork) && it.fromNodeId != id }
    }

    /**
     * Delete a scene, joining the scenes either side: everything that led INTO
     * it now leads to [joinTo] instead — by default the one place it led on
     * to, when there is exactly one. With several ways on, the author picks
     * (or passes null, and the doors in are left leading nowhere yet).
     * A door from [joinTo] itself is left unwired rather than made to loop
     * back to the scene it's in.
     */
    fun deleteScene(r: StoryRows, id: String, joinTo: String? = onward(r, id).singleOrNull()): StoryRows {
        require(id != r.story.rootNodeId) { "The entrance can't be deleted. Make another scene the entrance first." }
        val to = joinTo?.takeIf { it != id && r.nodes.any { n -> n.id == it } }
        if (to != null) return deleteScene(joinUp(r, id, to), id, null)
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

    /** Point everything that leads to [from] at [to] instead. */
    private fun joinUp(r: StoryRows, from: String, to: String): StoryRows {
        val fromOf = r.choices.associate { it.id to it.fromNodeId }
        return r.copy(
            choices = r.choices.map { if (it.toNodeId == from && it.fromNodeId != to) it.copy(toNodeId = to) else it },
            gates = r.gates.map { if (it.failNodeId == from && fromOf[it.choiceId] != to) it.copy(failNodeId = to) else it },
            nodes = r.nodes.map {
                if (it.id == to) it else it.copy(
                    timeoutTargetId = if (it.timeoutTargetId == from) to else it.timeoutTargetId,
                    invalidTargetId = if (it.invalidTargetId == from) to else it.invalidTargetId,
                )
            },
            fights = r.fights.map { f ->
                f.copy(winNodeId = if (f.winNodeId == from) to else f.winNodeId, loseNodeId = if (f.loseNodeId == from) to else f.loseNodeId)
            },
            fightRoundOutcomes = r.fightRoundOutcomes.map { if (it.toNodeId == from) it.copy(toNodeId = to) else it },
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
    fun setRequires(r: StoryRows, choiceId: String, varSlug: String?, mode: String = "refuse", failLine: String? = null, failNode: String? = null): StoryRows =
        setNeed(r, choiceId, varSlug?.let { Need(listOf(it), any = true) }, mode, failLine, failNode)

    /**
     * A requirement the phone can edit: one or more items, and whether the
     * caller needs ANY one of them ("the rope or the ladder") or ALL of them.
     * Underneath it is the same gate expression the web app writes — `has`,
     * or an `or` / `and` of `has` — so the engine, the playtest and the Twilio
     * export already understand it.
     */
    data class Need(val slugs: List<String>, val any: Boolean = true) {
        fun expression(): Expression? = when {
            slugs.isEmpty() -> null
            slugs.size == 1 -> Expression.Has(slugs[0])
            any -> Expression.Or(slugs.map { Expression.Has(it) })
            else -> Expression.And(slugs.map { Expression.Has(it) })
        }
    }

    /** The door's requirement as a [Need], or null if it has none or one too complex for the phone (a counter, a "lacks"). */
    fun need(r: StoryRows, choiceId: String): Need? {
        val e = r.gates.firstOrNull { it.choiceId == choiceId }?.expression ?: return null
        fun slugs(args: List<Expression>) = args.map { (it as? Expression.Has)?.v }.takeIf { l -> l.all { it != null } }?.filterNotNull()
        return when (e) {
            is Expression.Has -> Need(listOf(e.v))
            is Expression.Or -> slugs(e.args)?.let { Need(it, any = true) }
            is Expression.And -> slugs(e.args)?.takeIf { it.isNotEmpty() }?.let { Need(it, any = false) }
            else -> null
        }
    }

    /** Add or remove one item from what a door needs, keeping everything else about the gate. */
    fun toggleNeed(r: StoryRows, choiceId: String, slug: String): StoryRows {
        val now = need(r, choiceId) ?: Need(emptyList())
        val next = if (slug in now.slugs) now.slugs - slug else now.slugs + slug
        return setNeed(r, choiceId, now.copy(slugs = next).takeIf { next.isNotEmpty() })
    }

    /** Needs ANY one of its items, or ALL of them. */
    fun setNeedAny(r: StoryRows, choiceId: String, any: Boolean): StoryRows {
        val now = need(r, choiceId) ?: return r
        return setNeed(r, choiceId, now.copy(any = any))
    }

    /**
     * Set what a door needs. [mode], [failLine] and [failNode] default to what
     * the gate already says, so changing the items never forgets where a caller
     * without them goes. A null or empty [need] removes the condition.
     */
    fun setNeed(r: StoryRows, choiceId: String, need: Need?, mode: String? = null, failLine: String? = null, failNode: String? = null): StoryRows {
        val rest = r.gates.filterNot { it.choiceId == choiceId }
        val expr = need?.expression() ?: return r.copy(gates = rest)
        val old = r.gates.firstOrNull { it.choiceId == choiceId }
        val m = mode ?: old?.failBehavior ?: r.story.defaultFailBehavior
        val line = if (mode == null) old?.failNarration else failLine
        val node = if (mode == null) old?.failNodeId else failNode
        val g = GateRow(
            id = old?.id ?: newId(),
            choiceId = choiceId,
            expression = expr,
            failBehavior = m,
            failNarration = if (m == "refuse") line?.takeIf { it.isNotBlank() } else null,
            failAudioPath = if (m == "refuse") old?.failAudioPath else null,
            failNodeId = if (m == "divert") node else null,
            consumeOnPass = old?.consumeOnPass ?: false,
        )
        // Keep its place, so an edit doesn't reorder anything else.
        return if (old == null) r.copy(gates = rest + g) else r.copy(gates = r.gates.map { if (it.choiceId == choiceId) g else it })
    }

    /** What a door needs, in words, with item names: "the rope or the ladder". */
    fun needWords(r: StoryRows, n: Need): String {
        val names = n.slugs.map { sl -> r.stateVars.firstOrNull { it.slug == sl }?.name?.ifBlank { null } ?: sl }
        return when (names.size) {
            0 -> "nothing"
            1 -> names[0]
            else -> names.dropLast(1).joinToString(", ") + (if (n.any) " or " else " and ") + names.last()
        }
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
