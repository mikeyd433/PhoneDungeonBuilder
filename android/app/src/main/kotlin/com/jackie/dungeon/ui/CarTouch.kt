package com.jackie.dungeon.ui

import android.view.MotionEvent
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.car.Action
import com.jackie.dungeon.car.Mode
import com.jackie.dungeon.car.Scroll
import com.jackie.dungeon.gl.CrtRenderer
import kotlin.math.hypot

/**
 * Touches on the car screen, in the terminal's own pixels (through the glass's
 * bulge, so a tap lands where it looks like it does).
 *
 *   - a tap does whatever the last frame drew there; in PLAY, anywhere that
 *     isn't the EDIT tab skips the typing, as it always has;
 *   - a drag on the map pans it, on the script scrolls it, on the tiles
 *     scrolls them;
 *   - two fingers on the map zoom it, around the point between them. Many
 *     head units only report one finger; VIEW ▾ has ZOOM IN and OUT for those.
 */
class CarTouch(private val renderer: CrtRenderer) {
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var dragging: Scroll? = null
    private var moved = false
    private var pinching = false
    private var pinchDist = 0f
    private var acc = 0f

    fun onTouch(e: MotionEvent): Boolean {
        val editing = CarEdit.state.value.mode == Mode.EDIT
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val (x, y) = renderer.toSource(e.x, e.y)
                downX = x; downY = y; lastX = x; lastY = y
                moved = false; pinching = false; acc = 0f
                dragging = if (editing) CarEdit.frame?.scrollAt(x, y) else null
            }
            MotionEvent.ACTION_POINTER_DOWN -> if (editing && e.pointerCount == 2 && dragging == Scroll.MAP) {
                pinching = true; moved = true
                pinchDist = spread(e)
            }
            MotionEvent.ACTION_MOVE -> {
                if (pinching && e.pointerCount >= 2) {
                    val d = spread(e)
                    if (pinchDist > 0f && d > 0f) {
                        val (fx, fy) = renderer.toSource((e.getX(0) + e.getX(1)) / 2, (e.getY(0) + e.getY(1)) / 2)
                        CarEdit.dispatch(Action.ZoomBy(d / pinchDist, fx, fy))
                    }
                    pinchDist = d
                    return true
                }
                val (x, y) = renderer.toSource(e.x, e.y)
                val ch = CarEdit.viewport?.ch ?: 20f
                if (!moved && hypot(x - downX, y - downY) > ch * 0.5f) moved = true
                if (moved && !pinching) when (dragging) {
                    Scroll.MAP -> CarEdit.dispatch(Action.Pan(x - lastX, y - lastY))
                    Scroll.SCRIPT -> {
                        acc += y - lastY
                        while (acc <= -ch) { CarEdit.dispatch(Action.ScrollScript(1)); acc += ch }
                        while (acc >= ch) { CarEdit.dispatch(Action.ScrollScript(-1)); acc -= ch }
                    }
                    Scroll.TILES -> {
                        val step = (CarEdit.viewport?.cw ?: 9f) * 12f
                        acc += x - lastX
                        while (acc <= -step) { CarEdit.dispatch(Action.ScrollTiles(1)); acc += step }
                        while (acc >= step) { CarEdit.dispatch(Action.ScrollTiles(-1)); acc -= step }
                    }
                    null -> Unit
                }
                lastX = x; lastY = y
            }
            MotionEvent.ACTION_UP -> if (!moved) {
                val action = CarEdit.frame?.hit(downX, downY)
                when {
                    action != null -> CarEdit.dispatch(action)
                    !editing -> AppGraph.tapScreen()
                }
            }
        }
        return true
    }

    private fun spread(e: MotionEvent): Float {
        val (ax, ay) = renderer.toSource(e.getX(0), e.getY(0))
        val (bx, by) = renderer.toSource(e.getX(1), e.getY(1))
        return hypot(ax - bx, ay - by)
    }
}
