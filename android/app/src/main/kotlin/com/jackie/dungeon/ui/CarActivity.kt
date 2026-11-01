package com.jackie.dungeon.ui

import android.opengl.GLSurfaceView
import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.Studio
import com.jackie.dungeon.car.Action
import com.jackie.dungeon.car.Focus
import com.jackie.dungeon.car.Mode
import com.jackie.dungeon.gl.CrtRenderer
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The terminal, on the car display while parked — and, with [EXTRA_PREVIEW],
 * on the phone, at a head unit's proportions with the keypad beside it.
 *
 * Two modes, switched from either screen. PLAY is the terminal: a tap skips
 * the typing (or redials once the call has ended), and a corner tab goes to
 * EDIT. EDIT is the story's map and a page per scene ([com.jackie.dungeon.car.CarView]),
 * with typing done on the phone. The call is only "showing" in PLAY, so it
 * holds while the car is editing, exactly as when the screen goes away.
 */
class CarActivity : ComponentActivity() {
    private lateinit var surface: GLSurfaceView
    private lateinit var renderer: CrtRenderer
    private var resumed = false
    private val preview get() = intent.getBooleanExtra(EXTRA_PREVIEW, false)
    private val screenKey get() = if (preview) "preview" else "car"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        hideSystemBars()
        surface = GLSurfaceView(this).apply {
            setEGLContextClientVersion(3)
            renderer = CrtRenderer(applicationContext)
            setRenderer(renderer)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            val touch = CarTouch(renderer)
            setOnTouchListener { v, e ->
                if (e.actionMasked == MotionEvent.ACTION_UP) v.performClick()
                touch.onTouch(e)
            }
        }
        // The call runs only while this screen shows it: in PLAY, not while editing.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                CarEdit.state.map { it.mode }.distinctUntilChanged().collect { m -> AppGraph.setShowing(screenKey, m == Mode.PLAY) }
            }
        }
        if (!preview) {
            setContentView(FrameLayout(this).apply { addView(surface, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)) })
        } else {
            // The game in the middle at a car screen's shape, the keypad beside it, never over it.
            setContent {
                Row(Modifier.fillMaxSize().background(Phosphor.bg), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                        AndroidView(factory = { surface }, modifier = Modifier.aspectRatio(5f / 3f).padding(8.dp))
                    }
                    PreviewPanel()
                }
            }
        }
    }

    override fun onStart() { super.onStart(); AppGraph.activityStarted() }
    override fun onStop() { AppGraph.activityStopped(); super.onStop() }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        surface.onResume()
        CarEdit.setPresent(screenKey, true)
    }

    override fun onPause() {
        // Leaving park, Android Auto disconnecting or backgrounding: hold at once.
        AppGraph.setShowing(screenKey, false)
        CarEdit.setPresent(screenKey, false)
        surface.onPause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() = WindowCompat.getInsetsController(window, window.decorView).run {
        hide(WindowInsetsCompat.Type.systemBars())
        systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    companion object { const val EXTRA_PREVIEW = "preview" }
}

/**
 * Beside the preview: the car's switches, then the keypad in PLAY, or in EDIT
 * the sheet for whatever the car has open — the preview stands in for the
 * phone, so typing happens here.
 */
@androidx.compose.runtime.Composable
private fun PreviewPanel() {
    val s by CarEdit.state.collectAsStateWithLifecycle()
    val rows by Studio.rows.collectAsStateWithLifecycle()
    val focus by CarEdit.focus.collectAsStateWithLifecycle()
    androidx.compose.foundation.layout.Column(Modifier.width(320.dp).fillMaxHeight().padding(12.dp)) {
        CarControls()
        if (s.mode == Mode.PLAY || rows == null) {
            Keypad(Modifier.weight(1f).padding(top = 8.dp), compact = true)
            CarTextSize(Modifier.padding(top = 8.dp))
        } else Box(Modifier.weight(1f).padding(top = 8.dp)) {
            val r = rows!!
            when (val f = focus?.first) {
                is Focus.Choice -> ChoiceSheet(r, f.id, onClose = { CarEdit.clearDrafts() }, onGo = { CarEdit.dispatch(Action.OpenScene(it)) }, inSheet = false)
                is Focus.Scene -> SceneSheet(r, f.id, onClose = { CarEdit.clearDrafts() }, onChoice = { CarEdit.dispatch(Action.SelectChoice(it)) },
                    onPlay = { CarEdit.dispatch(Action.PlayHere(it)) }, onGo = { CarEdit.dispatch(Action.OpenScene(it)) }, inSheet = false)
                Focus.Map, null -> androidx.compose.material3.Text("Tap a scene on the screen to edit it here.", style = style(18, Phosphor.dim))
            }
        }
    }
    PlayHereDialog()
}
