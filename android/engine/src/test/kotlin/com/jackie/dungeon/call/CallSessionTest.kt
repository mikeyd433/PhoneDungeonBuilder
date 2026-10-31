package com.jackie.dungeon.call

import com.jackie.dungeon.call.CallSession.Phase
import com.jackie.dungeon.engine.StoryPack
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * The parked lifecycle, with no Android: the car screen comes and goes as
 * `hold()` and `resume()`, and time only passes when `tick` says so.
 */
class CallSessionTest {
    private val kitchen = StoryPack.parse(javaClass.getResource("/golden/kitchen.pack.json")!!.readText())
    private val demo = StoryPack.parse(javaClass.getResource("/golden/demo.pack.json")!!.readText())

    /** Run the clock long enough for everything to finish typing. */
    /** Play out whatever is queued and type until the prompt is up — and no
     *  further, or the room's timeout would fire. */
    private fun CallSession.settle() {
        repeat(600) {
            while (takeAudio() != null) Unit
            if (phase == Phase.WAITING || phase == Phase.ENDED) return
            tick(50)
        }
    }

    private fun text(s: CallSession) = s.visible().joinToString("\n") { it.text }

    @Test
    fun `dialling types the entrance and then waits for a key`() {
        val s = CallSession(demo)
        s.dial()
        assertEquals(Phase.DIALING, s.phase.let { if (it == Phase.TALKING) Phase.DIALING else it })
        assertTrue(s.visible().any { it.shown < it.text.length }, "nothing is typed instantly")
        s.settle()
        assertEquals(Phase.WAITING, s.phase)
        assertTrue(text(s).contains("== THE HOTLINE =="))
        assertTrue(text(s).contains("PRESS 1  GO UP ON DECK"))
    }

    @Test
    fun `the room's timeout only counts once the prompt is fully up`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        s.press("1"); while (s.takeAudio() != null) Unit
        assertEquals("n2", s.state!!.nodeId, "the pantry, which sends a silent caller back to the hall")
        s.audioBusy = true
        repeat(400) { s.tick(100) }
        assertNotEquals(Phase.WAITING, s.phase, "a take still playing holds the prompt back")
        s.audioBusy = false
        s.tick(100)
        assertEquals(Phase.WAITING, s.phase)
        val timeout = s.engine.node("n2")!!.timeoutSeconds
        repeat(timeout * 10 - 2) { s.tick(100) }
        assertEquals("n2", s.state!!.nodeId)
        repeat(3) { s.tick(100) }
        assertEquals("n1", s.state!!.nodeId, "silence took the caller back to the hall")
    }

    @Test
    fun `waiting in a scene that only repeats on the phone doesn't retype it on screen`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        val before = s.visible().size
        repeat(600) { s.tick(100) } // a minute of silence in the hall
        assertEquals(before, s.visible().size, "nothing was added")
        assertEquals(Phase.WAITING, s.phase)
    }

    @Test
    fun `a wrong key says so once, without the scene and the choices again`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        val hallLines = s.visible().count { it.text.contains("Who is there?") }
        s.press("9"); s.settle()
        assertEquals(hallLines, s.visible().count { it.text.contains("Who is there?") }, "the hall's script wasn't retyped")
        assertTrue(text(s).endsWith("That isn't one of the options."), text(s).takeLast(200))
        s.press("#"); s.settle()
        assertTrue(text(s).contains("Carrying nothing"), "the pockets readback still shows")
        assertEquals(hallLines, s.visible().count { it.text.contains("Who is there?") })
    }

    @Test
    fun `leaving park puts the call on hold, and the clock and keys stop`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        val clock = s.callMillis
        val node = s.state!!.nodeId
        s.hold()
        assertEquals(Phase.ON_HOLD, s.phase)
        repeat(100) { s.tick(1000) }
        assertEquals(clock, s.callMillis, "the call clock does not run on hold")
        s.press("1")
        assertEquals(node, s.state!!.nodeId, "a key on hold does nothing")
    }

    @Test
    fun `coming back counts 3 2 1 and then restores the line`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        s.hold(); s.resume()
        assertEquals(Phase.RECONNECTING, s.phase)
        assertEquals(3, s.countdown)
        s.tick(1000); assertEquals(2, s.countdown)
        s.tick(1000); assertEquals(1, s.countdown)
        s.press("1")
        assertEquals("n1", s.state!!.nodeId, "keys wait for the countdown")
        s.tick(1000)
        assertTrue(text(s).contains("— LINE RESTORED —"))
        s.settle()
        assertEquals(Phase.WAITING, s.phase)
        s.press("1")
        assertEquals("n2", s.state!!.nodeId)
    }

    @Test
    fun `a snapshot survives the process dying, and comes back on hold`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        s.press("1"); s.settle()
        val json = CallSession.json.encodeToString(CallSession.Snapshot.serializer(), s.snapshot())

        val back = CallSession(kitchen)
        back.restore(CallSession.json.decodeFromString(CallSession.Snapshot.serializer(), json))
        assertEquals(s.state, back.state)
        assertEquals(Phase.ON_HOLD, back.phase)
        assertEquals(s.held(), back.held())
        back.resume(); repeat(3) { back.tick(1000) }
        back.settle()
        assertEquals(Phase.WAITING, back.phase)
    }

    @Test
    fun `an ending hangs up and any key redials`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        // Cellar, then a key the cellar doesn't have: its invalid target is DEAD.
        s.press("2"); s.settle()
        s.press("9"); s.settle()
        assertEquals(Phase.ENDED, s.phase)
        assertTrue(text(s).contains("*** CALL ENDED. ***"))
        assertTrue(s.liveKeys().isEmpty())
        s.press("5")
        assertEquals("n1", s.state!!.nodeId)
        assertFalse(text(s).contains("CALL ENDED"))
    }

    @Test
    fun `the keypad lights what the room offers, locks included, plus the pockets key`() {
        val s = CallSession(kitchen)
        s.dial(); s.settle()
        assertEquals(setOf("1", "2", "3", "4", "5", "#"), s.liveKeys().keys)
        assertEquals("pockets", s.liveKeys()["#"])
    }

    @Test
    fun `recorded parts queue for the player, unrecorded ones don't`() {
        val s = CallSession(kitchen)
        s.dial()
        val queued = generateSequence { s.takeAudio() }.toList()
        assertTrue(queued.isNotEmpty())
        assertTrue(queued.all { it.audio != null })
    }
}
