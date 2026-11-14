package com.jackie.dungeon.story

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FindTest {
    private val william = StoryRows.parse(javaClass.getResource("/golden/william.rows.json")!!.readText())

    @Test
    fun `every sighting counts, in any case, in map order`() {
        val hits = Find.find(william, "carter", FlowLayout.layout(william))
        assertTrue(hits.size > 1, "Carter is all over this story")
        assertTrue(hits.all { it.text.substring(it.start, it.end).equals("carter", ignoreCase = true) })
        val layout = FlowLayout.layout(william)
        val ys = hits.map { layout.boxes[it.nodeId]?.y ?: Float.MAX_VALUE }
        assertEquals(ys.sorted(), ys, "walks down the map")
    }

    @Test
    fun `finds in scripts, choice names and replies, and nothing for blank`() {
        val root = william.story.rootNodeId!!
        val c = william.choices.first { it.fromNodeId == root }
        val r = william.copy(
            nodes = william.nodes.map { if (it.id == root) it.copy(narration = "A rope. Another ROPE.") else it },
            choices = william.choices.map { if (it.id == c.id) it.copy(reactionNarration = "Mind the rope") else it },
        )
        val hits = Find.find(r, "rope")
        assertEquals(2, hits.count { it.where == Find.Where.SCRIPT && it.nodeId == root })
        assertEquals(1, hits.count { it.where == Find.Where.REPLY && it.choiceId == c.id })
        assertTrue(Find.find(r, "   ").isEmpty())
    }

    @Test
    fun `spans and snippets mark the words`() {
        assertEquals(listOf(2..5, 12..15), Find.spans("A rope, the Rope", "rope"))
        val h = Find.Hit("n", null, Find.Where.SCRIPT, "x".repeat(100) + "needle" + "y".repeat(100), 100, 106)
        val (line, s, e) = Find.snippet(h, 40)
        assertEquals("needle", line.substring(s, e))
        assertTrue(line.startsWith("…") && line.endsWith("…"))
    }
}
