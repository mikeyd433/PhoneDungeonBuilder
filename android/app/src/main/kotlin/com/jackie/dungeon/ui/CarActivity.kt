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
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.gl.CrtRenderer

/**
 * The terminal, on the car display while parked — and, with [EXTRA_PREVIEW],
 * on the phone, at a head unit's proportions with the keypad beside it.
 *
 * A tap on the car touchscreen does one simple thing: skip the typing (or
 * redial once the call has ended). Everything else is the phone's.
 * It reports when it's showing, so the call goes on hold the moment it isn't.
 */
class CarActivity : ComponentActivity() {
    private lateinit var surface: GLSurfaceView
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
            setRenderer(CrtRenderer(applicationContext))
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
            setOnTouchListener { v, e ->
                if (e.actionMasked == MotionEvent.ACTION_DOWN) { AppGraph.tapScreen(); v.performClick() }
                true
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
                    androidx.compose.foundation.layout.Column(Modifier.width(300.dp).fillMaxHeight().padding(12.dp)) {
                        Keypad(Modifier.weight(1f), compact = true)
                        CarTextSize(Modifier.padding(top = 8.dp))
                    }
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
        AppGraph.setShowing(screenKey, true)
    }

    override fun onPause() {
        // Leaving park, Android Auto disconnecting or backgrounding: hold at once.
        AppGraph.setShowing(screenKey, false)
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
