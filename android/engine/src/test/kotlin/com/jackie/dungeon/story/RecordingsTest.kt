package com.jackie.dungeon.story

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RecordingsTest {
    private fun rows(name: String) = StoryRows.parse(javaClass.getResource("/golden/$name.rows.json")!!.readText())

    @Test
    fun `William's takes come in story order, starting at the entrance`() {
        val r = rows("william")
        val s = Recordings.slots(r)
        assertTrue(s.isNotEmpty())
        assertEquals(r.story.rootNodeId, s.first().sceneId, "the entrance's script comes first")
        assertTrue(s.none { it.recorded }, "nothing in William is recorded yet")
        assertTrue(s.any { it.kind == Recordings.Kind.REPLY }, "choice replies are on the list")
        assertEquals(r.nodes.size, Recordings.storyOrder(r).size)
    }

    @Test
    fun `a take attached to a slot fills it, and a script split by recorded lines becomes its lines`() {
        var r = StoryEditor.newStory("Takes")
        val start = r.story.rootNodeId!!
        r = StoryEditor.setScript(r, start, "Mike: Hello.\nCarter: Hi.")
        val one = Recordings.slots(r).single()
        assertEquals(Recordings.Kind.SCENE, one.kind)
        r = Recordings.set(r, one, "/x/start.wav", 1000)
        assertTrue(Recordings.slots(r).single().recorded)

        // Split by speaker and record a line: the scene now plays by line, so each line is a slot.
        r = StoryEditor.splitIntoLines(r, nodeId = start)
        val line = r.dialogueLines.first { it.nodeId == start }
        r = StoryEditor.setLineTake(r, line.id, "/x/line1.wav", 500)
        val slots = Recordings.slots(r)
        assertEquals(listOf(Recordings.Kind.LINE, Recordings.Kind.LINE), slots.map { it.kind })
        assertEquals(listOf(true, false), slots.map { it.recorded })
        assertTrue(slots[0].what.startsWith("Mike"))
    }

    @Test
    fun `endings have no replies, and a reply only counts once it has words`() {
        var r = StoryEditor.newStory("Replies")
        val start = r.story.rootNodeId!!
        r = StoryEditor.setScript(r, start, "Go on.")
        val (r1, door) = StoryEditor.addChoice(r, start, "On", newScene = true); r = r1
        assertEquals(1, Recordings.slots(r).size)
        r = StoryEditor.setReply(r, door, "Carter: Careful.")
        val reply = Recordings.slots(r).single { it.kind == Recordings.Kind.REPLY }
        assertEquals("START_reply_1", reply.fileName)
        r = Recordings.set(r, reply, "/x/r.wav", 300)
        assertEquals("/x/r.wav", r.choices.first { it.id == door }.audioPath)
    }
}
