package com.jackie.dungeon

import android.app.Application
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.jackie.dungeon.call.CallSession
import com.jackie.dungeon.call.TerminalLayout
import com.jackie.dungeon.engine.StoryPack
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * One process, one graph — the Brenda pattern.
 *
 * The phone keypad and the car screen are two activities in the same process.
 * Everything they share lives here, and everything that CHANGES the call runs
 * on [worker], one thread, so a key press, a clock tick and a save can never
 * interleave.
 *
 *   - The phone reads [ui], a snapshot published about ten times a second.
 *   - The car's renderer reads [screen], a snapshot published every tick.
 *   - [setShowing] is how the car screen (or the phone preview) says it came or
 *     went. With nothing showing, the call goes ON HOLD and is saved; when a
 *     screen comes back, it resumes behind a 3-2-1.
 */
object AppGraph {
    private const val TAG = "AppGraph"
    private const val TICK_MS = 33L
    private const val SAVE_EVERY_MS = 5_000L

    private lateinit var app: Application
    private val worker = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "jackie-worker") }
    private var ticker: ScheduledFuture<*>? = null
    private var lastTick = 0L
    private var lastSave = 0L
    private var lastUi = 0L

    private var session: CallSession? = null
    private lateinit var audio: AudioPlayer

    private val showing = linkedSetOf<String>()
    private var visibleActivities = 0

    private val _ui = MutableStateFlow(PhoneUi())
    val ui: StateFlow<PhoneUi> = _ui

    /** What the car renderer draws. Replaced whole, never mutated. */
    @Volatile var screen: Screen = Screen.EMPTY
        private set

    private val callFile get() = File(app.filesDir, "call.json")

    fun init(application: Application) {
        app = application
        audio = AudioPlayer(application) { worker.execute { session?.audioBusy = false } }
        carTextSize = app.getSharedPreferences("car", android.content.Context.MODE_PRIVATE).getInt("textSize", 1).coerceIn(0, CAR_TEXT_LINES.lastIndex)
        _carText.value = carTextSize
    }

    /** Lines of text that fill the car screen, per size: S, M, L, XL. */
    val CAR_TEXT_LINES = listOf(22, 17, 13, 10)
    val CAR_TEXT_NAMES = listOf("S", "M", "L", "XL")

    /** The car screen's text size, an index into [CAR_TEXT_LINES]. The renderer picks it up next frame. */
    @Volatile var carTextSize = 1
        private set

    private val _carText = MutableStateFlow(1)
    val carText: StateFlow<Int> = _carText

    fun setCarTextSize(i: Int) {
        carTextSize = i.coerceIn(0, CAR_TEXT_LINES.lastIndex)
        _carText.value = carTextSize
        app.getSharedPreferences("car", android.content.Context.MODE_PRIVATE).edit().putInt("textSize", carTextSize).apply()
    }

    /**
     * The story to play, from [Studio]. A call already in progress in the same
     * story is picked back up from its snapshot; a different story starts fresh.
     */
    fun setStory(pack: StoryPack) = worker.execute {
        pending = null
        audio.stop()
        val s = CallSession(pack)
        runCatching {
            if (callFile.exists()) {
                val snap = CallSession.json.decodeFromString(CallSession.Snapshot.serializer(), callFile.readText())
                if (snap.title == pack.title) s.restore(snap)
            }
        }.onFailure { Log.w(TAG, "snapshot", it) }
        session = s
        if (showing.isNotEmpty() && s.state == null) s.dial()
        publish(force = true)
    }

    /**
     * The open story was edited. A call isn't torn up mid-sentence for it: the
     * new version is used the next time the call is dialled, and right away if
     * nothing is showing it.
     */
    fun storyEdited(pack: StoryPack) = worker.execute {
        val s = session
        if (s == null || showing.isEmpty() || s.phase == CallSession.Phase.ENDED) {
            pending = null
            session = CallSession(pack)
            callFile.delete()
        } else pending = pack
        publish(force = true)
    }
    private var pending: StoryPack? = null

    /** Dial straight into one scene — "play from here" — optionally already carrying things. */
    fun playFrom(pack: StoryPack, carrying: Map<String, Int> = emptyMap()) = worker.execute {
        pending = null
        audio.stop()
        callFile.delete()
        session = CallSession(pack, carrying).also { if (showing.isNotEmpty()) it.dial() }
        publish(force = true)
    }

    /** One take, from the car editor's ▶. Stops whatever the call was saying. */
    fun playClip(url: String) = worker.execute {
        audio.stop()
        audio.play(url)
    }

    // ---- phone actions -------------------------------------------------------

    fun press(key: String) = worker.execute {
        val s = session ?: return@execute
        s.press(key)
        buzz()
        save()
        publish(force = true)
    }

    /** The car touchscreen's one job: skip the typing (or redial at the end). */
    fun tapScreen() = worker.execute {
        val s = session ?: return@execute
        if (s.phase == CallSession.Phase.ENDED) {
            pending?.let { p -> session = CallSession(p); pending = null }
            session?.dial()
        } else s.skipTyping()
        publish(force = true)
    }

    fun redial() = worker.execute {
        pending?.let { session = CallSession(it); pending = null }
        val s = session ?: return@execute
        audio.stop(); s.audioBusy = false
        s.dial()
        if (showing.isEmpty()) s.hold()
        save(); publish(force = true)
    }

    fun clearError() { _ui.value = _ui.value.copy(error = null) }

    // ---- lifecycle -------------------------------------------------------------

    /** The car screen or the preview came or went. */
    @Synchronized fun setShowing(which: String, on: Boolean) {
        if (on) showing += which else showing -= which
        val any = showing.isNotEmpty()
        worker.execute {
            val s = session ?: return@execute publish(force = true)
            if (any) {
                when {
                    s.state == null -> s.dial()
                    s.phase == CallSession.Phase.ON_HOLD -> s.resume()
                }
            } else {
                // Leaving park, Android Auto disconnecting, backgrounding: stop
                // talking at once and write the suspend save.
                audio.stop(); s.audioBusy = false
                s.hold()
                save()
            }
            publish(force = true)
        }
    }

    @Synchronized fun activityStarted() {
        visibleActivities++
        if (ticker == null) {
            lastTick = System.nanoTime()
            ticker = worker.scheduleWithFixedDelay(::tick, 0, TICK_MS, TimeUnit.MILLISECONDS)
        }
    }

    @Synchronized fun activityStopped() {
        visibleActivities = (visibleActivities - 1).coerceAtLeast(0)
        if (visibleActivities == 0) {
            ticker?.cancel(false); ticker = null
            worker.execute { save() }
        }
    }

    // ---- the loop -------------------------------------------------------------

    private fun tick() {
        try {
            val now = System.nanoTime()
            // Capped, so a stall (a GC, a backgrounded worker) never fast-forwards the story.
            val dt = ((now - lastTick) / 1_000_000L).coerceIn(0, 250)
            lastTick = now
            val s = session ?: return
            s.tick(dt)
            if (!audio.playing && !s.holding) {
                val next = s.takeAudio()
                if (next?.audio != null && audio.play(next.audio!!)) s.audioBusy = true
            }
            val ms = now / 1_000_000L
            if (ms - lastSave > SAVE_EVERY_MS) save()
            publish(force = false)
        } catch (e: Exception) {
            Log.e(TAG, "tick", e)
        }
    }

    private fun save() {
        val s = session ?: return
        lastSave = System.nanoTime() / 1_000_000L
        runCatching {
            val tmp = File(callFile.path + ".tmp")
            tmp.writeText(CallSession.json.encodeToString(CallSession.Snapshot.serializer(), s.snapshot()))
            tmp.renameTo(callFile)
        }.onFailure { Log.w(TAG, "save", it) }
    }

    private fun publish(force: Boolean) {
        val s = session
        screen = if (s == null) Screen.EMPTY else Screen(
            title = s.pack.title,
            scene = s.sceneTitle,
            lines = s.visible(),
            held = s.held(),
            clock = TerminalLayout.clock(s.callMillis),
            phase = s.phase,
            countdown = s.countdown,
            keys = s.liveKeys(),
        )
        val ms = System.nanoTime() / 1_000_000L
        if (!force && ms - lastUi < 100) return
        lastUi = ms
        _ui.value = PhoneUi(
            story = s?.pack?.title ?: "No story",
            scene = s?.sceneTitle ?: "",
            phase = s?.phase,
            countdown = s?.countdown ?: 0,
            keys = s?.liveKeys() ?: emptyMap(),
            held = s?.held() ?: emptyList(),
            carShowing = "car" in showing,
            previewShowing = "preview" in showing,
            error = _ui.value.error,
            edited = pending != null,
            lines = s?.visible() ?: emptyList(),
            clock = s?.let { TerminalLayout.clock(it.callMillis) } ?: "00:00",
            phoneShowing = "phone" in showing,
        )
    }

    private fun buzz() {
        runCatching {
            val v: Vibrator = if (Build.VERSION.SDK_INT >= 31)
                (app.getSystemService(VibratorManager::class.java)).defaultVibrator
            else @Suppress("DEPRECATION") app.getSystemService(Vibrator::class.java)
            v.vibrate(VibrationEffect.createOneShot(18, 120))
        }
    }
}

/** What the phone keypad shows. */
data class PhoneUi(
    val story: String = "",
    val scene: String = "",
    val phase: CallSession.Phase? = null,
    val countdown: Int = 0,
    /** digit -> what it does, for every key that does something right now. */
    val keys: Map<String, String> = emptyMap(),
    val held: List<String> = emptyList(),
    val carShowing: Boolean = false,
    val previewShowing: Boolean = false,
    val error: String? = null,
    /** An edit is waiting for the next redial. */
    val edited: Boolean = false,
    /** The transcript, for the phone's own play screen. */
    val lines: List<CallSession.Line> = emptyList(),
    val clock: String = "00:00",
    val phoneShowing: Boolean = false,
)

/** What the car screen draws. */
data class Screen(
    val title: String,
    val scene: String,
    val lines: List<CallSession.Line>,
    val held: List<String>,
    val clock: String,
    val phase: CallSession.Phase?,
    val countdown: Int,
    val keys: Map<String, String>,
) {
    companion object {
        val EMPTY = Screen("", "", emptyList(), emptyList(), "00:00", null, 0, emptyMap())
    }
}
