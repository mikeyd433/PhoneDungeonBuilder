package com.jackie.dungeon.story

import com.jackie.dungeon.engine.Engine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StoryEditorTest {
    private val william = StoryRows.parse(javaClass.getResource("/golden/william.rows.json")!!.readText())

    @Test
    fun `slugs follow the web app's rules`() {
        assertEquals("CIRCLING_IN_THE_DARK", StoryEditor.slugify("Circling in the dark"))
        assertEquals("N_11_FRIDAY", StoryEditor.slugify("11. Friday"))
        assertEquals("CAFE", StoryEditor.slugify("Café"))
        assertEquals("ROOM", StoryEditor.slugify("…"))
        assertEquals("SHARKS_2", StoryEditor.uniqueSlug("Sharks", listOf("SHARKS")))
    }

    @Test
    fun `a new story plays, and a door to a new scene takes the next free key`() {
        var r = StoryEditor.newStory("Test")
        val start = r.story.rootNodeId!!
        r = StoryEditor.setScript(r, start, "You wake up.")
        val (r2, door) = StoryEditor.addChoice(r, start, "Get up", newScene = true)
        val (r3, _) = StoryEditor.addChoice(r2, start, "Sleep in")
        assertEquals(listOf("1", "2"), r3.choices.map { it.digit })
        val behind = r3.choices.first { it.id == door }.toNodeId!!
        val r4 = StoryEditor.setScript(r3, behind, "You are up.")
        val e = Engine(PackBuilder.build(r4))
        val s = e.press(e.start(), "1")
        assertEquals(behind, s.next.nodeId)
        assertEquals("You are up.", s.heard.last().say)
    }

    @Test
    fun `deleting a scene leaves nothing pointing at it`() {
        val forest2 = william.nodes.first { it.slug == "FOREST_2" }.id
        val r = StoryEditor.deleteScene(william, forest2)
        assertTrue(r.nodes.none { it.id == forest2 })
        assertTrue(r.choices.none { it.toNodeId == forest2 || it.fromNodeId == forest2 })
        assertTrue(r.gates.none { it.failNodeId == forest2 })
        PackBuilder.build(r) // still a valid story
    }

    @Test
    fun `the entrance can't be deleted`() {
        assertFailsWith<IllegalArgumentException> { StoryEditor.deleteScene(william, william.story.rootNodeId!!) }
    }

    @Test
    fun `editing a split script keeps the takes of lines that didn't change`() {
        val room = william.nodes.first { it.slug == "CARTER_INTRO_0" }
        val withTake = william.copy(dialogueLines = william.dialogueLines.map {
            if (it.nodeId == room.id && it.text == "Thanks Mike.") it.copy(audioPath = "take.wav") else it
        })
        val edited = StoryEditor.setScript(withTake, room.id, room.narration.replace("big protagonist energy", "main character energy"))
        val lines = edited.dialogueLines.filter { it.nodeId == room.id }.sortedBy { it.sortOrder }
        assertEquals(3, lines.size)
        assertEquals("take.wav", lines.first { it.text == "Thanks Mike." }.audioPath)
        assertTrue(lines[0].text.contains("main character energy"))
        assertNull(lines[0].audioPath)
    }

    @Test
    fun `a fork on a door sends you elsewhere without the item, and a refusal keeps you`() {
        var r = StoryEditor.newStory("Fork")
        val start = r.story.rootNodeId!!
        val (a, door) = StoryEditor.addChoice(r, start, "Climb", newScene = true); r = a
        val (b, without) = StoryEditor.addScene(r, "Fall"); r = b
        val (c, rope) = StoryEditor.addItem(r, "Rope"); r = c
        r = StoryEditor.setRequires(r, door, rope.slug, mode = "divert", failNode = without)
        var e = Engine(PackBuilder.build(r))
        assertEquals(without, e.press(e.start(), "1").next.nodeId)

        r = StoryEditor.setRequires(r, door, rope.slug, mode = "refuse", failLine = "You need a rope.")
        e = Engine(PackBuilder.build(r))
        val t = e.press(e.start(), "1")
        assertEquals(start, t.next.nodeId)
        assertEquals("You need a rope.", t.heard.single().say)

        r = StoryEditor.setRequires(r, door, null)
        e = Engine(PackBuilder.build(r))
        assertTrue(e.press(e.start(), "1").next.nodeId != start)
    }

    @Test
    fun `a door can give an item`() {
        var r = StoryEditor.newStory("Give")
        val start = r.story.rootNodeId!!
        val (a, door) = StoryEditor.addChoice(r, start, "Take it", newScene = true); r = a
        val (b, coin) = StoryEditor.addItem(r, "Coin"); r = b
        r = StoryEditor.setGives(r, door, coin.id)
        assertEquals("Coin", StoryEditor.gives(r, door)?.name)
        val e = Engine(PackBuilder.build(r))
        assertEquals(listOf("Coin"), e.held(e.press(e.start(), "1").next))
    }

    @Test
    fun `william's helmet conditions read back in words`() {
        val g = william.gates.first()
        assertEquals("has CARTERHELMET or has MIKEHELMET", StoryEditor.describe(g.expression))
        assertNull(StoryEditor.simpleRequirement(william, g.choiceId), "an OR isn't the simple editor's to change")
    }
}
