package com.jackie.dungeon.car

import com.jackie.dungeon.story.Dialogue
import com.jackie.dungeon.story.StoryRows

/**
 * What the map can light up when the author asks it to, and what a scene page
 * says is still silent. Derived every time, never stored (§0).
 *
 * "Recorded" means what PLAYS has audio — `playbackFor`, not `audio_path`
 * (principle 8): once a scene plays line by line, its one-file take is not
 * what is heard.
 */
object CarSurvey {

    /** Each silent part of a scene, in words: its script, a reply, a refusal. */
    fun silentParts(r: StoryRows, nodeId: String): List<String> {
        val n = r.nodes.firstOrNull { it.id == nodeId } ?: return emptyList()
        val out = ArrayList<String>()
        val parts = Dialogue.playbackFor(r, n).filter { it.say.isNotBlank() || it.audio != null }
        val silent = parts.count { it.audio.isNullOrEmpty() }
        if (silent > 0) out += if (parts.size == 1) "SCRIPT" else "$silent LINE${if (silent == 1) "" else "S"}"
        for (c in r.choices.filter { it.fromNodeId == nodeId }) {
            if (Dialogue.reactionPlaybackFor(r, c).any { it.audio.isNullOrEmpty() && it.say.isNotBlank() }) out += "REPLY ${c.digit}"
            val g = r.gates.firstOrNull { it.choiceId == c.id }
            if (g != null && g.failBehavior == "refuse" && !g.failNarration.isNullOrBlank() && g.failAudioPath.isNullOrEmpty()) out += "REFUSAL ${c.digit}"
        }
        return out
    }

    fun isEmpty(r: StoryRows, nodeId: String): Boolean {
        val n = r.nodes.firstOrNull { it.id == nodeId } ?: return false
        return n.narration.isBlank() && r.dialogueLines.none { it.nodeId == nodeId && it.text.isNotBlank() }
    }

    /** A scene that isn't an ending and has no way out: the call would drop there. */
    fun isDeadEnd(r: StoryRows, nodeId: String): Boolean {
        val n = r.nodes.firstOrNull { it.id == nodeId } ?: return false
        if (n.nodeType == "ending") return false
        if (r.fights.any { it.nodeId == nodeId }) return false
        return r.choices.none { it.fromNodeId == nodeId } && n.timeoutTargetId == null
    }

    fun isUnrecorded(r: StoryRows, nodeId: String) = silentParts(r, nodeId).isNotEmpty()

    /** Scene id -> which highlights it matches, for the ones switched on. */
    fun marks(r: StoryRows, on: Set<Highlight>): Map<String, List<Highlight>> {
        if (on.isEmpty()) return emptyMap()
        val out = HashMap<String, List<Highlight>>()
        for (n in r.nodes) {
            val m = Highlight.entries.filter { h ->
                h in on && when (h) {
                    Highlight.EMPTY -> isEmpty(r, n.id)
                    Highlight.DEAD_END -> isDeadEnd(r, n.id)
                    Highlight.UNRECORDED -> isUnrecorded(r, n.id)
                }
            }
            if (m.isNotEmpty()) out[n.id] = m
        }
        return out
    }
}
