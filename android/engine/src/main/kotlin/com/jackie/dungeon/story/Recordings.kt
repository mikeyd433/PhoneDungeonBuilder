package com.jackie.dungeon.story

/**
 * Every take a story needs, in the order a caller hears them — for the
 * RECORDINGS list, which shows what's still missing and attaches finished
 * files one at a time.
 *
 * What counts follows principle 8: a script is one take until any of its
 * speaker lines has a take of its own; from then on it plays line by line, so
 * each line is a slot (and the one-file take no longer is).
 */
object Recordings {

    enum class Kind { SCENE, LINE, REPLY, REPLY_LINE }

    data class Slot(
        val kind: Kind,
        val sceneId: String,
        val choiceId: String? = null,
        val lineId: String? = null,
        /** The scene it belongs to (a reply belongs to the scene its choice is in). */
        val scene: String,
        /** What this take is: "Script", "Carter, line 2", "Reply to 1". */
        val what: String,
        /** The words to be read. */
        val text: String,
        val path: String?,
        val ms: Int?,
        /** What to call the file. */
        val fileName: String,
    ) {
        val recorded get() = !path.isNullOrEmpty()
    }

    /** Scenes in the order a caller meets them: from the start, each scene's choices by key; anything unreachable last. */
    fun storyOrder(r: StoryRows): List<NodeRow> {
        val byId = r.nodes.associateBy { it.id }
        val seen = LinkedHashSet<String>()
        val queue = ArrayDeque<String>()
        r.story.rootNodeId?.let { if (it in byId) queue.add(it) }
        while (queue.isNotEmpty()) {
            val u = queue.removeFirst()
            if (!seen.add(u)) continue
            for (c in FlowLayout.doorsOf(r, u)) {
                listOfNotNull(c.toNodeId, r.gates.firstOrNull { it.choiceId == c.id && it.failBehavior == "divert" }?.failNodeId)
                    .filter { it in byId && it !in seen }.forEach(queue::addLast)
            }
        }
        return seen.mapNotNull(byId::get) + r.nodes.filter { it.id !in seen }
    }

    fun slots(r: StoryRows): List<Slot> {
        val names = r.characters.associate { it.id to it.name }
        val out = ArrayList<Slot>()
        for (n in storyOrder(r)) {
            val title = n.title.ifBlank { n.slug }
            val lines = r.dialogueLines.filter { it.nodeId == n.id }.sortedBy { it.sortOrder }
            if (Dialogue.splitsByLine(r, nodeId = n.id)) {
                lines.forEachIndexed { i, l ->
                    out += Slot(Kind.LINE, n.id, lineId = l.id, scene = title, what = (names[l.characterId] ?: "Narrator") + ", line ${i + 1}",
                        text = l.text, path = l.audioPath, ms = l.audioDurationMs, fileName = "${n.slug}_line_${i + 1}")
                }
            } else if (n.narration.isNotBlank()) {
                out += Slot(Kind.SCENE, n.id, scene = title, what = "Script", text = n.narration, path = n.audioPath, ms = n.audioDurationMs, fileName = n.slug)
            }
            if (n.nodeType == "ending") continue
            for (c in FlowLayout.doorsOf(r, n.id)) {
                val replyLines = r.dialogueLines.filter { it.choiceId == c.id }.sortedBy { it.sortOrder }
                if (Dialogue.splitsByLine(r, choiceId = c.id)) {
                    replyLines.forEachIndexed { i, l ->
                        out += Slot(Kind.REPLY_LINE, n.id, choiceId = c.id, lineId = l.id, scene = title, what = "Reply to ${c.digit}, " + (names[l.characterId] ?: "Narrator") + " line ${i + 1}",
                            text = l.text, path = l.audioPath, ms = l.audioDurationMs, fileName = "${n.slug}_reply_${c.digit}_line_${i + 1}")
                    }
                } else if (!c.reactionNarration.isNullOrBlank()) {
                    out += Slot(Kind.REPLY, n.id, choiceId = c.id, scene = title, what = "Reply to ${c.digit} · ${c.label.ifBlank { "(no name)" }}",
                        text = c.reactionNarration, path = c.audioPath, ms = c.audioDurationMs, fileName = "${n.slug}_reply_${c.digit}")
                }
            }
        }
        return out
    }

    /** Put a take on a slot (or clear it with null). */
    fun set(r: StoryRows, s: Slot, path: String?, ms: Int?): StoryRows = when (s.kind) {
        Kind.SCENE -> StoryEditor.setSceneTake(r, s.sceneId, path, ms)
        Kind.REPLY -> StoryEditor.setReplyTake(r, s.choiceId!!, path, ms)
        Kind.LINE, Kind.REPLY_LINE -> StoryEditor.setLineTake(r, s.lineId!!, path, ms)
    }
}
