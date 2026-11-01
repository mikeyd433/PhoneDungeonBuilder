package com.jackie.dungeon.story

import com.jackie.dungeon.engine.Engine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StoryEditorTest {
    private val william = StoryRows.parse(javaClass.getResource("/golden/william.rows.json")!!.readText())
    private fun rows(name: String) = StoryRows.parse(javaClass.getResource("/golden/$name.rows.json")!!.readText())

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
    fun `deleting a scene in the middle joins the scenes either side`() {
        var r = StoryEditor.newStory("Test")
        val a = r.story.rootNodeId!!
        val (r1, door) = StoryEditor.addChoice(r, a, "Go on", newScene = true); r = r1
        val b = r.choices.first { it.id == door }.toNodeId!!
        val (r2, onward) = StoryEditor.addChoice(r, b, "Keep going", newScene = true); r = r2
        val c = r.choices.first { it.id == onward }.toNodeId!!
        assertEquals(listOf(c), StoryEditor.onward(r, b))
        val joined = StoryEditor.deleteScene(r, b)
        assertEquals(c, joined.choices.first { it.id == door }.toNodeId, "A's door now leads to C")
        assertEquals("Go on", joined.choices.first { it.id == door }.label, "and keeps its own name")

        // Two ways on: nothing is guessed unless the author says which.
        val (r3, other) = StoryEditor.addChoice(r, b, "Turn back", newScene = true)
        val d = r3.choices.first { it.id == other }.toNodeId!!
        assertEquals(listOf(c, d), StoryEditor.onward(r3, b))
        assertNull(StoryEditor.deleteScene(r3, b).choices.first { it.id == door }.toNodeId)
        assertEquals(d, StoryEditor.deleteScene(r3, b, joinTo = d).choices.first { it.id == door }.toNodeId)
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
    fun `a take on a scene, a reply and a refusal is what the player plays`() {
        var r = StoryEditor.newStory("Takes")
        val start = r.story.rootNodeId!!
        r = StoryEditor.setScript(r, start, "Hello.")
        val (a, door) = StoryEditor.addChoice(r, start, "Go", newScene = true); r = a
        val (b, key) = StoryEditor.addItem(r, "Key"); r = b
        r = StoryEditor.setReply(r, door, "Off you go.")
        r = StoryEditor.setRequires(r, door, key.slug, "refuse", failLine = "Locked.")
        r = StoryEditor.setSceneTake(r, start, "/takes/start.wav", 1200)
        r = StoryEditor.setReplyTake(r, door, "/takes/reply.wav", 800)
        r = StoryEditor.setRefusalTake(r, door, "/takes/locked.wav")
        val pack = PackBuilder.build(r)
        assertEquals("/takes/start.wav", pack.nodes.first { it.id == start }.playback.single().audio)
        assertEquals("/takes/reply.wav", pack.choices.single().reaction.single().audio)
        val e = Engine(pack)
        assertEquals("/takes/locked.wav", e.press(e.start(), "1").heard.single().audio)
        // Clearing forgets the length too.
        val cleared = StoryEditor.setSceneTake(r, start, null)
        assertNull(cleared.nodes.first { it.id == start }.audioDurationMs)
    }

    @Test
    fun `william's helmet conditions read back in words`() {
        val g = william.gates.first()
        assertEquals("has CARTERHELMET or has MIKEHELMET", StoryEditor.describe(g.expression))
        assertNull(StoryEditor.simpleRequirement(william, g.choiceId), "an OR isn't the simple editor's to change")
    }

    @Test
    fun `a choice can need one item or another, and each answer goes to its own scene`() {
        var r = rows("kitchen")
        val hall = r.story.rootNodeId!!
        val (r1, door) = StoryEditor.addChoice(r, hall, "Climb out", newScene = true)
        r = r1
        val items = r.stateVars.filter { it.kind == "item" }.take(2)
        r = StoryEditor.toggleNeed(r, door, items[0].slug)
        r = StoryEditor.toggleNeed(r, door, items[1].slug)
        assertEquals(com.jackie.dungeon.engine.Expression.Or(items.map { com.jackie.dungeon.engine.Expression.Has(it.slug) }), r.gates.first { it.choiceId == door }.expression)
        val (r2, without) = StoryEditor.addScene(r, "Stuck")
        r = StoryEditor.setNeed(r2, door, StoryEditor.need(r2, door), "divert", failNode = without)
        // Changing the items keeps where a caller without them goes.
        r = StoryEditor.setNeedAny(r, door, false)
        val g = r.gates.first { it.choiceId == door }
        assertTrue(g.expression is com.jackie.dungeon.engine.Expression.And)
        assertEquals("divert", g.failBehavior); assertEquals(without, g.failNodeId)
        assertEquals(items[0].name + " and " + items[1].name, StoryEditor.needWords(r, StoryEditor.need(r, door)!!))

        // The engine sends a caller with either item one way and one with neither the other.
        r = StoryEditor.setNeedAny(r, door, true)
        val pack = PackBuilder.build(r)
        val e = com.jackie.dungeon.engine.Engine(pack)
        val key = r.choices.first { it.id == door }.digit
        val to = r.choices.first { it.id == door }.toNodeId
        assertEquals(without, e.press(e.start(), key).next.nodeId)
        assertEquals(to, e.press(e.start(mapOf(items[1].slug to 1)), key).next.nodeId)
        r = StoryEditor.toggleNeed(StoryEditor.toggleNeed(r, door, items[0].slug), door, items[1].slug)
        assertTrue(r.gates.none { it.choiceId == door }, "untick everything and the condition goes")
    }

    @Test
    fun `the layout can be saved as the default and reset back to it`() {
        var r = rows("william")
        val a = r.nodes[3].id; val b = r.nodes[5].id
        r = StoryEditor.nudgeScene(r, a, 50f, 0f)
        r = StoryEditor.saveLayoutAsDefault(r)
        assertTrue(!StoryEditor.layoutChanged(r))
        r = StoryEditor.nudgeScene(r, b, 0f, 80f)
        r = StoryEditor.nudgeScene(r, a, 10f, 0f)
        assertTrue(StoryEditor.layoutChanged(r))
        r = StoryEditor.resetLayout(r)
        assertEquals(50f, r.nodes.first { it.id == a }.nudgeX)
        assertEquals(0f, r.nodes.first { it.id == b }.nudgeY)
        r = StoryEditor.autoLayout(r)
        assertTrue(!StoryEditor.hasNudges(r) && r.story.layoutHome.isEmpty())
    }
}
