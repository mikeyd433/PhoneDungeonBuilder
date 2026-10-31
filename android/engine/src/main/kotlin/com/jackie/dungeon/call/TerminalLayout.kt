package com.jackie.dungeon.call

import com.jackie.dungeon.call.CallSession.Kind

/**
 * Lays a call's transcript out on a fixed character grid — what the car's
 * renderer draws, cell by cell.
 *
 * Pure, so the wrapping is tested on the JVM rather than by squinting at a
 * head unit: word-wrapped to [cols], continuation lines indented under the
 * text rather than the margin, newest at the bottom, and the oldest rows
 * dropped once the screen is full.
 */
object TerminalLayout {

    data class Row(val text: String, val kind: Kind, val voice: Int)

    /** The rows for the transcript body, bottom-aligned, at most [rows] of them. */
    fun body(lines: List<CallSession.Line>, cols: Int, rows: Int): List<Row> {
        if (cols <= 0 || rows <= 0) return emptyList()
        val out = ArrayList<Row>()
        for (l in lines) {
            if (l.shown <= 0 && l.text.isNotEmpty()) continue
            val text = l.text.take(l.shown.coerceAtMost(l.text.length))
            val indent = if (l.kind == Kind.OPT) text.indexOfFirst { it != ' ' }.coerceAtLeast(0) + 9 else 0
            wrap(text, cols, indent.coerceAtMost(cols / 2)).forEach { out += Row(it, l.kind, l.voice) }
        }
        return if (out.size > rows) out.subList(out.size - rows, out.size) else out
    }

    /** Word wrap with a hanging indent for continuation lines. Never loses text. */
    fun wrap(text: String, cols: Int, hang: Int = 0): List<String> {
        if (text.isEmpty()) return listOf("")
        val out = ArrayList<String>()
        var rest = text
        var first = true
        while (rest.isNotEmpty()) {
            val pad = if (first) "" else " ".repeat(hang)
            val room = (cols - pad.length).coerceAtLeast(1)
            if (rest.length <= room) { out += pad + rest; break }
            var cut = rest.lastIndexOf(' ', room)
            if (cut <= 0) cut = room
            out += pad + rest.substring(0, cut).trimEnd()
            rest = rest.substring(cut).trimStart()
            first = false
        }
        return out
    }

    /** Fit a status bar to [cols]: left and right, truncating the left. */
    fun status(left: String, right: String, cols: Int): String {
        val r = right.take(cols)
        val roomForLeft = (cols - r.length - 1).coerceAtLeast(0)
        val l = if (left.length > roomForLeft) left.take((roomForLeft - 1).coerceAtLeast(0)) + "…" else left
        return l.padEnd(cols - r.length) + r
    }

    fun clock(millis: Long): String {
        val s = millis / 1000
        return "%02d:%02d".format(s / 60, s % 60)
    }
}
