package com.jackie.dungeon.call

import com.jackie.dungeon.call.CallSession.Kind
import com.jackie.dungeon.call.CallSession.Line
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TerminalLayoutTest {
    @Test
    fun `wraps at word boundaries and keeps every character`() {
        val text = "The deck tilts. Something circles below the waterline."
        val rows = TerminalLayout.wrap(text, 16)
        assertTrue(rows.all { it.length <= 16 }, rows.toString())
        assertEquals(text.replace(" ", ""), rows.joinToString("").replace(" ", ""))
    }

    @Test
    fun `a word longer than the screen is broken rather than lost`() {
        assertEquals(listOf("ABCDE", "FGHIJ", "K"), TerminalLayout.wrap("ABCDEFGHIJK", 5))
    }

    @Test
    fun `continuation lines hang under the text`() {
        val rows = TerminalLayout.wrap("PRESS 1  GO UP ON DECK AND LOOK", 14, hang = 4)
        assertTrue(rows.drop(1).all { it.startsWith("    ") }, rows.toString())
    }

    @Test
    fun `only typed characters show, and the newest rows win`() {
        val lines = listOf(
            Line("old line", Kind.SAY, shown = 8),
            Line("middle", Kind.SAY, shown = 6),
            Line("being typed", Kind.SAY, shown = 5),
            Line("not yet", Kind.SAY, shown = 0),
        )
        val body = TerminalLayout.body(lines, cols = 40, rows = 2)
        assertEquals(listOf("middle", "being"), body.map { it.text })
    }

    @Test
    fun `the status bar always fits`() {
        val s = TerminalLayout.status("THE VERY LONG NAME OF A ROOM", "00:42", 20)
        assertEquals(20, s.length)
        assertTrue(s.endsWith("00:42"))
    }
}
