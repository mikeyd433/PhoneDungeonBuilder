package com.jackie.dungeon.story

import com.jackie.dungeon.engine.Part

/**
 * Port of src/features/cast/dialogue.ts: narration split into attributed
 * lines and back, and what a room or a door's reaction actually plays.
 *
 * Held to the TypeScript by `splits.json` (every script in every fixture,
 * split by the web app) and by the packs in `PackBuilderTest`.
 */
object Dialogue {

    data class Spoken(val speaker: String?, val text: String)

    private const val NAME = "[A-Z][A-Za-z0-9'’.-]*(?:[ \\t]+[A-Z][A-Za-z0-9'’.-]*){0,2}"
    private val LEADING = Regex("^($NAME)[ \\t]*:[ \\t]*(.*)$")
    private val INLINE = Regex("([.!?…][\"'”’)\\]]?)[ \\t]+($NAME[ \\t]*:[ \\t])")
    private const val MAX_SPEAKER_LENGTH = 28
    private val NOT_SPEAKERS = setOf("note", "notes", "sfx", "fx", "music", "sound", "warning", "todo", "tip", "cue", "http", "https")

    private fun isSpeakerName(name: String) =
        name.length <= MAX_SPEAKER_LENGTH && name.trimJs().lowercase() !in NOT_SPEAKERS

    fun split(narration: String): List<Spoken> {
        if (narration.trimJs().isEmpty()) return emptyList()
        val normalised = INLINE.replace(narration, "$1\n$2")
        val out = ArrayList<Spoken>()
        for (raw in normalised.split('\n')) {
            val line = raw.trimJs()
            if (line.isEmpty()) continue
            val m = LEADING.find(line)
            if (m != null && isSpeakerName(m.groupValues[1]) && m.groupValues[2].trimJs().isNotEmpty()) {
                out += Spoken(m.groupValues[1].trimJs(), m.groupValues[2].trimJs())
            } else out += Spoken(null, line)
        }
        return out
    }

    fun compose(lines: List<Spoken>): String = lines
        .filter { it.text.trimJs().isNotEmpty() }
        .joinToString("\n") { if (it.speaker != null && it.speaker.isNotEmpty()) "${it.speaker}: ${it.text.trimJs()}" else it.text.trimJs() }

    // ---- what plays ------------------------------------------------------------

    private fun linesOf(rows: StoryRows, nodeId: String? = null, choiceId: String? = null) =
        rows.dialogueLines.filter { if (nodeId != null) it.nodeId == nodeId else it.choiceId == choiceId }.sortedBy { it.sortOrder }

    private fun part(rows: StoryRows, l: LineRow) =
        Part(l.id, l.audioPath, l.text, l.characterId?.let { id -> rows.characters.firstOrNull { it.id == id }?.name })

    /** One recorded line is the switch: the owner then plays line by line. */
    fun splitsByLine(rows: StoryRows, nodeId: String? = null, choiceId: String? = null) =
        linesOf(rows, nodeId, choiceId).any { !it.audioPath.isNullOrEmpty() }

    fun playbackFor(rows: StoryRows, node: NodeRow): List<Part> =
        if (!splitsByLine(rows, nodeId = node.id)) listOf(Part(node.id, node.audioPath, node.narration, null))
        else linesOf(rows, nodeId = node.id).map { part(rows, it) }

    fun reactionPlaybackFor(rows: StoryRows, c: ChoiceRow): List<Part> {
        if (!splitsByLine(rows, choiceId = c.id)) {
            return if (!c.audioPath.isNullOrEmpty() || (c.reactionNarration ?: "").trimJs().isNotEmpty())
                listOf(Part(c.id, c.audioPath, c.reactionNarration ?: "", null)) else emptyList()
        }
        return linesOf(rows, choiceId = c.id).map { part(rows, it) }
    }

    /** What an item says as it changes hands — `clipFor` in itemClips.ts. */
    fun clipFor(v: StateVarRow, gain: Boolean): Part? {
        val say = (if (gain) v.gainNarration else v.spendNarration)?.trimJs() ?: ""
        val audio = if (gain) v.gainAudioPath else v.spendAudioPath
        if (say.isEmpty() && audio.isNullOrEmpty()) return null
        return Part("${v.id}:${if (gain) "gain" else "spend"}", audio, say, null)
    }
}

/** JavaScript's `trim()`. */
internal fun String.trimJs(): String = trim { it.isWhitespace() || it == '﻿' || it == ' ' }
