package com.jackie.dungeon.call

import com.jackie.dungeon.engine.Engine
import com.jackie.dungeon.engine.Part
import com.jackie.dungeon.engine.State
import com.jackie.dungeon.engine.StoryPack
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * One phone call into a story, as the car screen shows it: a terminal that
 * types the story out, a keypad, a call clock — and a hold button nobody
 * presses, because the CAR presses it by driving off.
 *
 * Pure Kotlin and single-threaded: `AppGraph` owns one and calls it from one
 * worker. Time only moves when [tick] is called, so the parked lifecycle is
 * testable without a clock (`CallSessionTest`).
 *
 * The phases:
 *
 *   DIALING       the modem line, then the entrance
 *   TALKING       typing out what was heard; keys skip ahead and answer
 *   WAITING       the prompt is up; the room's timeout is counting
 *   ON_HOLD       the car screen went away (moved off, unplugged, backgrounded)
 *   RECONNECTING  3-2-1 on the way back, so nobody is dropped mid-sentence
 *   ENDED         an ending was reached; any key redials
 */
class CallSession(
    val pack: StoryPack,
    /** What the caller starts with — "play from here" with items in hand. */
    private val carrying: Map<String, Int> = emptyMap(),
    private val speakers: List<String> = speakersOf(pack),
) {

    enum class Phase { DIALING, TALKING, WAITING, ON_HOLD, RECONNECTING, ENDED }

    enum class Kind { SYS, HEAD, SAY, SILENT, OPT, INPUT, WARN, END_WIN, END_DEATH }

    @Serializable
    data class Line(
        val text: String,
        val kind: Kind,
        /** 0 = narrator / first speaker colour, 1.. = other speakers. */
        val voice: Int = 0,
        var shown: Int = 0,
    )

    /** Everything needed to pick a call back up after the process dies. */
    @Serializable
    data class Snapshot(
        val title: String,
        val state: State?,
        val lines: List<Line>,
        val callMillis: Long,
        val phase: Phase,
        val resumeTo: Phase,
    )

    val engine = Engine(pack)

    var state: State? = null; private set
    var phase = Phase.DIALING; private set
    private var resumeTo = Phase.TALKING
    private val lines = ArrayList<Line>()
    private var typed = 0.0
    var callMillis = 0L; private set
    private var waitedMillis = 0L
    private var countdownMillis = 0L

    /** Parts whose audio the player should play, in order. Drained by the app. */
    private val audioQueue = ArrayDeque<Part>()

    /** Set by the app while a take is playing; the timeout waits for it. */
    var audioBusy = false

    // ---- what the screens read ------------------------------------------

    /** The transcript, with typing applied. Copies, so the renderer can hold it. */
    fun visible(): List<Line> = lines.map { it.copy() }

    val holding get() = phase == Phase.ON_HOLD || phase == Phase.RECONNECTING

    /** 3, 2, 1 while reconnecting. */
    val countdown: Int get() = if (phase == Phase.RECONNECTING) ((countdownMillis + 999) / 1000).toInt().coerceAtLeast(1) else 0

    val sceneTitle: String
        get() = state?.let { s -> engine.node(s.nodeId)?.let { it.title.ifEmpty { it.slug } } } ?: pack.title

    fun held(): List<String> = state?.let(engine::held) ?: emptyList()

    /** Keys that do something right now, for the phone keypad. */
    fun liveKeys(): Map<String, String> {
        val s = state ?: return emptyMap()
        if (phase == Phase.ENDED) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (k in engine.keys(s)) out[k.digit] = if (k.open) k.label.ifEmpty { "…" } else "locked"
        pack.inventoryKey?.let { if (s.fightRound == null && it !in out) out[it] = "pockets" }
        return out
    }

    fun takeAudio(): Part? = audioQueue.removeFirstOrNull()

    // ---- driving it --------------------------------------------------------

    fun dial() {
        lines.clear(); audioQueue.clear(); typed = 0.0; callMillis = 0; waitedMillis = 0
        phase = Phase.DIALING
        add("ATDT ${pack.title.uppercase()}", Kind.SYS)
        add("RING . . . RING . . . CONNECTED", Kind.SYS)
        val s = engine.start(carrying)
        state = s
        if (s.finished && s.nodeId.isEmpty()) {
            add("[this story has no entrance yet]", Kind.WARN)
            phase = Phase.ENDED
            return
        }
        hear(engine.arrival(s), header = true)
        afterTurn()
    }

    /** A key from the phone keypad (or the car's touchscreen). */
    fun press(key: String) {
        when (phase) {
            Phase.ON_HOLD, Phase.RECONNECTING -> return
            Phase.ENDED -> { dial(); return }
            else -> Unit
        }
        val s = state ?: return dial()
        skipTyping()
        audioQueue.clear()
        add("> $key", Kind.INPUT)
        take(s, engine.press(s, key))
    }

    /**
     * Show a turn. When the caller stays where they were (a wrong key, the
     * pockets key, a refusal), the phone line reads the scene out again — the
     * engine says so, and the export does it — but on a screen the scene is
     * still right there, so retyping it is only noise. Show what is NEW, and
     * leave the choices on the keypad rather than listing them again.
     */
    private fun take(before: State, turn: com.jackie.dungeon.engine.Turn) {
        state = turn.next
        val stayed = turn.next.nodeId == before.nodeId
        val replay = if (stayed) engine.arrival(before).map { it.id }.toSet() else emptySet()
        hear(turn.heard.filter { it.id !in replay }, header = !stayed)
        afterTurn(prompt = !stayed || turn.next.fightRound != before.fightRound)
    }

    /** Skip the typing to the end, as a tap on the car screen does. */
    fun skipTyping() {
        for (l in lines) l.shown = l.text.length
        typed = 0.0
    }

    /**
     * Advance time. Typing runs at [charsPerSecond]; the clock runs unless the
     * call is on hold; the room's timeout counts only once everything has been
     * typed AND heard, because a caller cannot answer a question still being
     * asked.
     */
    fun tick(dtMillis: Long, charsPerSecond: Double = 40.0) {
        if (phase == Phase.ON_HOLD) return
        if (phase == Phase.RECONNECTING) {
            countdownMillis -= dtMillis
            if (countdownMillis <= 0) {
                phase = resumeTo
                waitedMillis = 0
                add("— LINE RESTORED —", Kind.SYS)
                state?.let { if (phase == Phase.WAITING || phase == Phase.TALKING) prompt(it) }
            }
            return
        }
        callMillis += dtMillis
        typed += dtMillis * charsPerSecond / 1000.0
        var budget = typed.toInt()
        typed -= budget
        for (l in lines) {
            if (budget <= 0) break
            val left = l.text.length - l.shown
            if (left <= 0) continue
            val n = minOf(left, budget)
            l.shown += n
            budget -= n
        }
        val doneTyping = lines.all { it.shown >= it.text.length }
        if (phase == Phase.TALKING || phase == Phase.DIALING) {
            if (doneTyping && audioQueue.isEmpty() && !audioBusy) { phase = Phase.WAITING; waitedMillis = 0 }
        } else if (phase == Phase.WAITING) {
            val s = state ?: return
            // Silence only matters on screen when it DOES something: a scene that
            // sends a quiet caller elsewhere, or a fight round, where silence
            // counts against you. Otherwise the phone would just read the scene
            // again, and the screen waits instead of retyping it every few seconds.
            val node = engine.node(s.nodeId) ?: return
            if (node.timeoutTarget == null && s.fightRound == null) return
            val limit = node.timeoutSeconds.coerceAtLeast(1) * 1000L
            waitedMillis += dtMillis
            if (waitedMillis >= limit) {
                waitedMillis = 0
                add("[no answer]", Kind.SYS)
                take(s, engine.timeout(s))
            }
        }
    }

    /** The car screen went away. Finish the sentence on screen, stop talking. */
    fun hold() {
        if (phase == Phase.ON_HOLD || phase == Phase.ENDED) return
        resumeTo = if (phase == Phase.RECONNECTING) resumeTo else phase
        if (resumeTo == Phase.DIALING) resumeTo = Phase.TALKING
        skipTyping()
        audioQueue.clear()
        phase = Phase.ON_HOLD
    }

    /** The car screen is back: count in, then carry on. */
    fun resume(countFrom: Int = 3) {
        if (phase != Phase.ON_HOLD) return
        phase = Phase.RECONNECTING
        countdownMillis = countFrom * 1000L
    }

    fun snapshot() = Snapshot(pack.title, state, lines.takeLast(MAX_LINES).map { it.copy() }, callMillis, phase, resumeTo)

    fun restore(s: Snapshot) {
        state = s.state
        lines.clear(); lines.addAll(s.lines.map { it.copy(shown = it.text.length) })
        callMillis = s.callMillis
        audioQueue.clear()
        // Whatever it was doing, a restored call starts on hold: the screen
        // that is about to show it will resume it with the countdown.
        resumeTo = when (s.phase) { Phase.ON_HOLD, Phase.RECONNECTING -> s.resumeTo; Phase.DIALING -> Phase.TALKING; else -> s.phase }
        phase = if (s.phase == Phase.ENDED) Phase.ENDED else Phase.ON_HOLD
    }

    // ---- internals -----------------------------------------------------------

    private fun add(text: String, kind: Kind, voice: Int = 0) {
        lines += Line(text, kind, voice)
        while (lines.size > MAX_LINES) lines.removeAt(0)
    }

    private fun hear(parts: List<Part>, header: Boolean) {
        val s = state
        if (header && s != null) {
            add("", Kind.SYS)
            add("== ${sceneTitle.uppercase()} ==", Kind.HEAD)
        }
        for (p in parts) {
            val voice = p.speaker?.let { speakers.indexOf(it).coerceAtLeast(0) + 1 } ?: 0
            val text = if (p.speaker != null) "${p.speaker.uppercase()}: ${p.say}" else p.say
            add(text, if (p.audio != null) Kind.SAY else Kind.SILENT, voice)
            if (p.audio != null) audioQueue.addLast(p)
        }
    }

    private fun afterTurn(prompt: Boolean = true) {
        val s = state ?: return
        if (s.finished) {
            val win = engine.node(s.nodeId)?.endingKind == "win"
            add("", Kind.SYS)
            add(if (win) "*** YOU MADE IT. CALL ENDED. ***" else "*** CALL ENDED. ***", if (win) Kind.END_WIN else Kind.END_DEATH)
            add("press any key to redial", Kind.SYS)
            phase = Phase.ENDED
            return
        }
        phase = Phase.TALKING
        if (prompt) prompt(s)
    }

    private fun prompt(s: State) {
        val keys = engine.keys(s)
        if (keys.isEmpty() && s.fightRound == null) {
            add("[nothing to press here yet: the call would drop]", Kind.WARN)
            return
        }
        add("", Kind.SYS)
        for (k in keys) add("  PRESS ${k.digit}  ${k.label.ifEmpty { "(no words yet)" }.uppercase()}${if (k.open) "" else "  [LOCKED]"}", Kind.OPT)
        pack.inventoryKey?.let { if (s.fightRound == null && keys.none { k -> k.digit == it }) add("  PRESS $it  WHAT YOU'RE CARRYING", Kind.OPT) }
    }

    companion object {
        const val MAX_LINES = 240
        val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** Speakers in order of first appearance, for colouring. */
        fun speakersOf(pack: StoryPack): List<String> {
            val seen = LinkedHashSet<String>()
            pack.nodes.forEach { n -> n.playback.forEach { p -> p.speaker?.let(seen::add) } }
            pack.choices.forEach { c -> c.reaction.forEach { p -> p.speaker?.let(seen::add) } }
            return seen.toList()
        }
    }
}
