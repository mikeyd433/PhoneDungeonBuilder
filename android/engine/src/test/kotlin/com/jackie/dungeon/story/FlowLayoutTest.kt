package com.jackie.dungeon.story

import com.jackie.dungeon.story.FlowLayout.Edge
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FlowLayoutTest {
    private fun rows(name: String) = StoryRows.parse(javaClass.getResource("/golden/$name.rows.json")!!.readText())

    @Test
    fun `every scene gets a box, the entrance on top, and nothing overlaps`() {
        val r = rows("william")
        val l = FlowLayout.layout(r)
        assertEquals(r.nodes.size, l.boxes.size)
        val root = l.boxes[r.story.rootNodeId]!!
        assertTrue(l.boxes.values.all { it.y >= root.y })
        val boxes = l.boxes.values.toList()
        for (i in boxes.indices) for (j in i + 1 until boxes.size) {
            val a = boxes[i]; val b = boxes[j]
            val overlap = a.x < b.x + FlowLayout.W && b.x < a.x + FlowLayout.W && a.y < b.bottom && b.y < a.bottom
            assertTrue(!overlap, "${a.id} overlaps ${b.id}")
        }
    }

    @Test
    fun `william's helmet fork draws as a diamond, and loops as links`() {
        val r = rows("william")
        val l = FlowLayout.layout(r)
        val fork = l.edges.filterIsInstance<Edge.Fork>()
        assertEquals(1, fork.size)
        assertEquals("has CARTERHELMET or has MIKEHELMET", fork.single().item)
        assertTrue(l.edges.any { it is Edge.Loop }, "the hell house loops back on itself")
        assertTrue(l.edges.filterIsInstance<Edge.Forward>().all { e -> l.boxes[e.to]!!.y > l.boxes.values.first { it.id == r.choices.first { c -> c.id == e.choiceId }.fromNodeId }.y })
    }

    @Test
    fun `scenes nothing leads to sit in a row of their own, at the bottom`() {
        val r = rows("jcfc")
        val l = FlowLayout.layout(r)
        assertTrue(l.unreachable.isNotEmpty())
        val lowestReached = l.boxes.values.filter { it.id !in l.unreachable }.maxOf { it.y }
        assertTrue(l.unreachable.all { l.boxes[it]!!.y > lowestReached })
    }

    @Test
    fun `a nudge moves only that box`() {
        val r = rows("demo")
        val a = FlowLayout.layout(r)
        val id = r.nodes[2].id
        val b = FlowLayout.layout(r, mapOf(id to (40f to 10f)))
        assertEquals(a.boxes[id]!!.x + 40f, b.boxes[id]!!.x)
        assertEquals(a.boxes[r.nodes[0].id], b.boxes[r.nodes[0].id])
    }

    @Test
    fun `chapters are lanes - Mike's and Carter's stories never share a column`() {
        var r = rows("william")
        val mike = r.nodes.first { it.slug == "GNOME_RUNS_BY_AND" }.id
        val carter = r.nodes.first { it.slug == "CARTER_INTRO_0" }.id
        val mikeBranch = StoryEditor.branchOf(r, mike)
        val carterBranch = StoryEditor.branchOf(r, carter)
        assertTrue(mikeBranch.size > 3 && carterBranch.size > 3, "${mikeBranch.size} / ${carterBranch.size}")
        assertTrue(mikeBranch.intersect(carterBranch).isEmpty())
        r = StoryEditor.setChapter(r, mikeBranch, "Mike")
        r = StoryEditor.setChapter(r, carterBranch, "Carter")
        val l = FlowLayout.layout(r)
        val m = l.chapters.first { it.name == "Mike" }
        val c = l.chapters.first { it.name == "Carter" }
        assertTrue(m.x1 <= c.x0 || c.x1 <= m.x0, "the two lanes overlap: $m / $c")
        for (id in mikeBranch) assertTrue(l.boxes[id]!!.x >= m.x0 && l.boxes[id]!!.x + FlowLayout.W <= m.x1)
        assertEquals(listOf("Mike", "Carter").sorted(), StoryEditor.chapters(r).sorted())
    }

    @Test
    fun `a branch stops where another path joins it`() {
        val r = rows("william")
        val swamp = r.nodes.first { it.slug == "PRESS_1_TO_BUY" }.id
        val corridor = r.nodes.first { it.slug == "PRESS_1_TO_TURN" }.id
        // The swamp is reached from the lily pads and from the frog's spell, both inside the corridor's branch.
        assertTrue(swamp in StoryEditor.branchOf(r, corridor))
        // But the corridor itself is reached by three different doors from Carter's helmet scene only.
        assertTrue(StoryEditor.branchOf(r, swamp).none { it == corridor })
    }
}
