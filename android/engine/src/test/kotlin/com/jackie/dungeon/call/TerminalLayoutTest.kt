package com.jackie.dungeon.call

import com.jackie.dungeon.call.CallSession.Kind
import com.jackie.dungeon.call.CallSession.Line
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TerminalLayoutTest {
    private fun rows(n: Int) = TerminalLayout.all((1..n).map { Line("line $it", Kind.SAY, shown = 99) }, 40)

    @Test
    fun `following shows the newest, scrolled back stays put while text arrives`() {
        val ten = rows(10)
        assertEquals("line 10", TerminalLayout.window(ten, 4, null).rows.last().text)
        // Back three rows: lines 4-7 on screen, three below.
        val top = TerminalLayout.scrolled(ten.size, 4, null, -3)
        assertEquals(3, top)
        val w = TerminalLayout.window(ten, 4, top)
        assertEquals(listOf("line 4", "line 5", "line 6", "line 7"), w.rows.map { it.text })
        assertEquals(3, w.below)
        // Five more lines come in: the same four stay on screen.
        val more = TerminalLayout.window(rows(15), 4, top)
        assertEquals("line 4", more.rows.first().text)
        assertEquals(8, more.below)
    }

    @Test
    fun `scrolling down to the bottom follows again, and never past the top`() {
        assertEquals(null, TerminalLayout.scrolled(10, 4, 3, +3))
        assertEquals(null, TerminalLayout.scrolled(10, 4, 3, +50))
        assertEquals(0, TerminalLayout.scrolled(10, 4, null, -50))
        assertEquals(null, TerminalLayout.scrolled(3, 4, null, -2), "nothing to scroll when it all fits")
    }


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
