package com.jackie.dungeon

import android.os.Handler
import android.os.Looper
import com.jackie.dungeon.car.Action
import com.jackie.dungeon.car.CarEditor
import com.jackie.dungeon.car.CarState
import com.jackie.dungeon.car.CarView
import com.jackie.dungeon.car.Effect
import com.jackie.dungeon.car.Focus
import com.jackie.dungeon.car.Frame
import com.jackie.dungeon.car.Highlight
import com.jackie.dungeon.car.MapInfo
import com.jackie.dungeon.car.Mode
import com.jackie.dungeon.car.Popup
import com.jackie.dungeon.car.Viewport
import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.StoryRows
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * The car screen's editor, shared by the car, the phone and the preview —
 * one state, so the two screens can never disagree about what is open.
 *
 * The rules are all in [CarEditor] (pure, tested); this object only carries
 * out what it hands back: edits go through [Studio] (so they save and undo
 * like any other), the phone is told what to open, takes play through
 * [AppGraph]'s player, and "play from here" dials.
 *
 * The renderer reads [state] and writes [viewport] and [frame] every frame;
 * a touch is turned into an [Action] by asking the last [frame] what was there.
 */
object CarEdit {
    private val main = Handler(Looper.getMainLooper())

    private val _state = MutableStateFlow(CarState())
    val state: StateFlow<CarState> = _state

    // Narrow views of the state, for the phone's screens. The full state changes on
    // every frame of a flowchart pan (the car mirrors it); a screen that only needs
    // the mode, the highlights or the popup shouldn't recompose for that.
    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())
    private fun <T> slice(f: (CarState) -> T): StateFlow<T> =
        _state.map { f(it) }.distinctUntilChanged().stateIn(scope, SharingStarted.Eagerly, f(_state.value))
    val mode: StateFlow<Mode> by lazy { slice { it.mode } }
    val highlights: StateFlow<Set<Highlight>> by lazy { slice { it.highlights } }
    val popup: StateFlow<Popup?> by lazy { slice { it.popup } }

    /** What the phone should open now, with a counter so the same thing twice still counts. */
    private val _focus = MutableStateFlow<Pair<Focus, Long>?>(null)
    val focus: StateFlow<Pair<Focus, Long>?> = _focus

    /** Text being typed on the phone, shown on the car before it is saved. */
    private val _drafts = MutableStateFlow<Map<String, String>>(emptyMap())
    val drafts: StateFlow<Map<String, String>> = _drafts

    /** Is a car screen (or the preview) up at all, in either mode? */
    private val _present = MutableStateFlow(false)
    val present: StateFlow<Boolean> = _present
    private val screens = linkedSetOf<String>()

    @Volatile var viewport: Viewport? = null
    @Volatile var frame: Frame? = null

    // ---- caches, so a frame doesn't lay out 139 scenes 30 times a second ----

    private var layoutFor: StoryRows? = null
    private var layout: FlowLayout.Layout? = null
    private var infoFor: Pair<StoryRows, Set<Highlight>>? = null
    private var info: MapInfo? = null
    private var draftedFor: Pair<StoryRows, Map<String, String>>? = null
    private var drafted: StoryRows? = null

    @Synchronized private fun layoutOf(r: StoryRows): FlowLayout.Layout {
        if (layoutFor !== r) { layout = FlowLayout.layout(r); layoutFor = r }
        return layout!!
    }

    @Synchronized private fun rowsNow(): StoryRows? {
        val base = Studio.rows.value ?: return null
        val d = _drafts.value
        if (draftedFor?.first !== base || draftedFor?.second != d) { drafted = CarEditor.withDrafts(base, d); draftedFor = base to d }
        return drafted
    }

    @Synchronized private fun infoOf(r: StoryRows, h: Set<Highlight>): MapInfo {
        if (infoFor?.first !== r || infoFor?.second != h) { info = MapInfo.of(r, h); infoFor = r to h }
        return info!!
    }

    /** One frame of EDIT mode, or null with no story open. Called on the GL thread. */
    fun render(v: Viewport): Frame? {
        viewport = v
        val base = Studio.rows.value ?: return null
        val r = rowsNow() ?: return null
        val s = _state.value
        return CarView.render(r, layoutOf(base), s, v, infoOf(r, s.highlights), Studio.undo.value.isNotEmpty()).also { frame = it }
    }

    private val fallback = Viewport(600f, 360f, 9f, 21f)

    // ---- what taps do ---------------------------------------------------------

    fun dispatch(a: Action) = main.post {
        val base = Studio.rows.value ?: return@post
        val r = rowsNow() ?: return@post
        val v = viewport ?: fallback
        val o = CarEditor.dispatch(_state.value, r, layoutOf(base), v, a)
        _state.value = o.state
        o.edit?.let { e -> Studio.editWith(e.label) { cur -> e.run(cur) }?.let { _state.value = it } }
        for (eff in o.effects) when (eff) {
            is Effect.FocusPhone -> _focus.value = eff.focus to System.nanoTime()
            is Effect.PlayTake -> AppGraph.playClip(Studio.audioUrl(eff.path))
            is Effect.StartCall -> Studio.rows.value?.let { AppGraph.playFrom(Studio.packOf(it, startAt = eff.nodeId), eff.carrying) }
            Effect.Undo -> Studio.undo()
        }
        val p = _state.value.popup
        if (p is Popup.Notice) main.postDelayed({ if (_state.value.popup === p) _state.value = _state.value.copy(popup = null) }, 3500)
    }

    fun setMode(m: Mode) = dispatch(if (m == Mode.PLAY) Action.ToPlay else Action.ToEdit)

    fun toggle(h: Highlight) = dispatch(Action.Toggle(h))

    /** The phone opened a scene: the car goes to it. */
    fun followScene(id: String) = main.post {
        val base = Studio.rows.value ?: return@post
        _state.value = CarEditor.follow(_state.value, base, layoutOf(base), id, viewport)
    }

    /** The phone's sheet closed. */
    fun sheetClosed() = main.post { _state.value = CarEditor.sheetClosed(_state.value) }

    fun followChoice(id: String) = main.post {
        val base = Studio.rows.value ?: return@post
        _state.value = CarEditor.followChoice(_state.value, base, layoutOf(base), id, viewport)
    }

    /** The phone's flowchart moved: the car's map follows it while mirroring. */
    fun phoneView(v: com.jackie.dungeon.car.PhoneView) {
        val s = _state.value
        if (s.phone != v) _state.value = s.copy(phone = v)
    }

    /** Where everyone else is, for the car's markers. */
    fun others(m: Map<String, List<String>>) { val s = _state.value; if (s.others != m) _state.value = s.copy(others = m) }

    /** CAR SCREEN SETTINGS changed the mirror. */
    fun mirrorSettings(margin: Float, lift: Float) {
        val s = _state.value
        if (s.mirrorMargin != margin || s.mirrorLift != lift) _state.value = s.copy(mirrorMargin = margin, mirrorLift = lift)
    }

    fun draft(key: String, text: String) { _drafts.value = _drafts.value + (key to text) }
    fun clearDrafts() { if (_drafts.value.isNotEmpty()) _drafts.value = emptyMap() }

    /** A different story was opened: nothing on the car refers to the old one. */
    fun reset() { _state.value = CarState(mode = _state.value.mode, highlights = _state.value.highlights); clearDrafts() }

    @Synchronized fun setPresent(which: String, on: Boolean) {
        if (on) screens += which else screens -= which
        _present.value = screens.isNotEmpty()
    }
}
