package com.jackie.dungeon.story

import com.jackie.dungeon.story.FlowLayout.Edge
import kotlin.test.Test
import kotlin.test.assertFailsWith
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
        val words = StoryEditor.needWords(r, StoryEditor.need(r, fork.single().choiceId)!!)
        assertTrue(" or " in words, words)
        assertEquals(words, fork.single().item, "the diamond names the items, not their slugs")
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

    private fun chaptered(): StoryRows {
        var r = rows("william")
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "GNOME_RUNS_BY_AND" }.id), "Mike")
        return StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "CARTER_INTRO_0" }.id), "Carter")
    }

    @Test
    fun `the entrance spans the lanes rather than sitting in a lane of its own`() {
        val r = chaptered()
        val l = FlowLayout.layout(r)
        val root = l.boxes[r.story.rootNodeId]!!
        val left = l.chapters.minOf { it.x0 }; val right = l.chapters.maxOf { it.x1 }
        assertTrue(root.cx > left && root.cx < right, "the entrance sits over the lanes: ${root.cx} in $left..$right")
    }

    @Test
    fun `a lane moved by hand takes every scene in it, and reset puts it back`() {
        val r = chaptered()
        val before = FlowLayout.layout(r)
        val moved = StoryEditor.nudgeChapter(r, "Mike", 300f, 50f)
        val after = FlowLayout.layout(moved)
        for (n in r.nodes) {
            val a = before.boxes[n.id] ?: continue; val b = after.boxes[n.id]!!
            if (n.chapter == "Mike") { assertEquals(a.x + 300f, b.x); assertEquals(a.y + 50f, b.y) }
            else { assertEquals(a.x, b.x); assertEquals(a.y, b.y) }
        }
        val one = r.nodes.first { it.chapter == "Carter" }.id
        val nudged = StoryEditor.nudgeScene(moved, one, -20f, 10f)
        assertEquals(before.boxes[one]!!.x - 20f, FlowLayout.layout(nudged).boxes[one]!!.x)
        assertTrue(StoryEditor.hasNudges(nudged))
        val reset = StoryEditor.resetLayout(nudged)
        assertTrue(!StoryEditor.hasNudges(reset))
        assertEquals(before.boxes, FlowLayout.layout(reset).boxes)
        // Renaming a chapter keeps where its lane was moved to.
        assertEquals(listOf(300f, 50f), StoryEditor.renameChapter(moved, "Mike", "Mikey").story.laneNudges["Mikey"])
    }

    @Test
    fun `a sub-chapter is a lane inside its chapter, and moving the chapter moves it too`() {
        var r = chaptered()
        // Mike's story splits: the first fork after his intro starts two paths.
        val mikeNodes = r.nodes.filter { it.chapter == "Mike" }.map { it.id }.toSet()
        val split = mikeNodes.first { id -> StoryEditor.onward(r, id).count { it in mikeNodes } >= 2 }
        val (a, b) = StoryEditor.onward(r, split).filter { it in mikeNodes }.take(2)
        val pathA = StoryEditor.branchOf(r, a); val pathB = StoryEditor.branchOf(r, b)
        assertTrue(pathA.isNotEmpty() && pathB.isNotEmpty() && pathA.intersect(pathB).isEmpty())
        r = StoryEditor.setChapter(r, pathA, "Mike/Path A")
        r = StoryEditor.setChapter(r, pathB, "Mike/Path B")
        val cs = StoryEditor.chapters(r)
        assertEquals(setOf("Mike", "Mike/Path A", "Mike/Path B", "Carter"), cs.toSet())
        assertEquals(cs.indexOf("Mike") + 1, minOf(cs.indexOf("Mike/Path A"), cs.indexOf("Mike/Path B")), "sub-chapters follow their chapter: $cs")
        val l = FlowLayout.layout(r)
        val mike = l.chapters.first { it.name == "Mike" }
        val fa = l.chapters.first { it.name == "Mike/Path A" }; val fb = l.chapters.first { it.name == "Mike/Path B" }
        val carter = l.chapters.first { it.name == "Carter" }
        // The paths sit side by side, inside Mike's frame, and Mike's is still apart from Carter's.
        assertTrue(fa.x1 <= fb.x0 || fb.x1 <= fa.x0, "the two paths share a column: $fa / $fb")
        for (f in listOf(fa, fb)) assertTrue(f.x0 > mike.x0 && f.x1 < mike.x1 && f.y0 > mike.y0 && f.y1 < mike.y1, "$f is not inside $mike")
        assertTrue(mike.x1 <= carter.x0 || carter.x1 <= mike.x0)
        assertEquals("Path A", fa.label)
        assertTrue(StoryEditor.inChapter(r.nodes.first { it.id == pathA.first() }, "Mike"), "a Path A scene is still Mike's")
        // Mike's intro spans both paths rather than taking a lane of its own.
        val intro = l.boxes[split]!!
        assertTrue(intro.cx > minOf(fa.x0, fb.x0) && intro.cx < maxOf(fa.x1, fb.x1))

        val moved = FlowLayout.layout(StoryEditor.nudgeChapter(r, "Mike", 100f, 0f))
        assertEquals(l.boxes[pathA.first()]!!.x + 100f, moved.boxes[pathA.first()]!!.x)
        val sub = FlowLayout.layout(StoryEditor.nudgeChapter(r, "Mike/Path A", 40f, 0f))
        assertEquals(l.boxes[pathA.first()]!!.x + 40f, sub.boxes[pathA.first()]!!.x)
        assertEquals(l.boxes[pathB.first()]!!.x, sub.boxes[pathB.first()]!!.x)

        // Renaming Mike carries his paths along.
        val renamed = StoryEditor.renameChapter(r, "Mike", "Michael")
        assertTrue(renamed.nodes.any { it.chapter == "Michael/Path A" } && renamed.nodes.none { it.chapter?.startsWith("Mike") == true })
    }

    @Test
    fun `an existing chapter can be moved inside another, and back out`() {
        var r = chaptered()
        val carterScenes = r.nodes.filter { it.chapter == "Carter" }.map { it.id }.toSet()
        r = StoryEditor.nudgeChapter(r, "Carter", 50f, 0f)
        r = StoryEditor.moveChapter(r, "Carter", "Mike")
        assertTrue(r.nodes.filter { it.id in carterScenes }.all { it.chapter == "Mike/Carter" })
        assertEquals(listOf(50f, 0f), r.story.laneNudges["Mike/Carter"], "its hand-made move comes with it")
        val l = FlowLayout.layout(r)
        val mike = l.chapters.first { it.name == "Mike" }; val inner = l.chapters.first { it.name == "Mike/Carter" }
        assertTrue(inner.x0 > mike.x0 && inner.x1 < mike.x1)
        assertTrue(StoryEditor.chapterHomes(r, "Mike").isEmpty(), "Mike can't go inside its own sub-chapter")
        assertFailsWith<IllegalArgumentException> { StoryEditor.moveChapter(r, "Mike", "Mike/Carter") }
        r = StoryEditor.moveChapter(r, "Mike/Carter", null)
        assertTrue(r.nodes.filter { it.id in carterScenes }.all { it.chapter == "Carter" })
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
