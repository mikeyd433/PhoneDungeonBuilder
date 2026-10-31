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
}
