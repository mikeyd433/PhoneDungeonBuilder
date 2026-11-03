package com.jackie.dungeon.gl

import android.content.Context
import android.opengl.GLES30.*
import android.opengl.GLSurfaceView
import android.opengl.GLUtils
import android.util.Log
import androidx.core.content.res.ResourcesCompat
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.R
import com.jackie.dungeon.Screen
import com.jackie.dungeon.call.CallSession.Kind
import com.jackie.dungeon.call.CallSession.Phase
import com.jackie.dungeon.call.TerminalLayout
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.Studio
import com.jackie.dungeon.car.CarView
import com.jackie.dungeon.car.Frame
import com.jackie.dungeon.car.Ink
import com.jackie.dungeon.car.Mode
import com.jackie.dungeon.car.Op
import com.jackie.dungeon.car.Viewport
import kotlin.math.abs
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.roundToInt

/**
 * The car screen: a green-phosphor terminal on a curved tube.
 *
 * Two passes, tuned for head units (weak GPUs, and they run hot):
 *
 *   1. The terminal is drawn as text into a small offscreen texture —
 *      [internalHeight] rows of pixels, 360 by default — one draw call, one
 *      quad per character, from a [GlyphAtlas].
 *   2. That texture is drawn to the real screen through the CRT shader: barrel
 *      distortion (the glass really is curved here, unlike the web prototype,
 *      because nothing on this screen needs a precise tap), scanlines locked to
 *      the source rows, an aperture mask, a little bloom, a vignette and a slow
 *      rolling bar.
 *
 * Frame rate is capped at [fps] by sleeping in [onDrawFrame]. Everything GL is
 * rebuilt in [onSurfaceCreated], because a recreated surface (a reconnect) has
 * lost the old context's resources.
 */
class CrtRenderer(private val context: Context, private val fps: Int = 30, private val internalHeight: Int = 360) :
    GLSurfaceView.Renderer {

    private var textProgram = 0
    private var crtProgram = 0
    private var atlasTex = 0
    private var vbo = 0
    private var fbo = 0
    private var fboTex = 0
    private var srcW = 640
    private var srcH = internalHeight
    private var outW = 1
    private var outH = 1
    private lateinit var atlas: GlyphAtlas
    private var verts: FloatBuffer = alloc(4096)
    /** This frame's vertices, written as plain floats and handed to GL in one copy. */
    private var stage = FloatArray(4096)
    private var sp = 0
    private val uv = FloatArray(4)
    // Uniform locations, looked up once per surface rather than every frame.
    private var uRes = -1; private var uAtlas = -1
    private var uTex = -1; private var uSrc = -1; private var uBar = -1; private var uFlick = -1
    private var uCurve = -1; private var uScan = -1; private var uGlow = -1; private var uBarAmt = -1; private var uTint = -1; private var uMono = -1
    /** The rolling band's position, advanced each frame by its speed (so changing the speed doesn't make it jump). */
    private var barPhase = 0.0
    private var lastSeconds = -1.0
    /**
     * What the offscreen terminal last drew. Pass 1 is only redone when this
     * changes — while nothing is typing, blinking or being edited, a frame is
     * just the CRT pass over the texture already there.
     */
    private var drawnKey: Any? = null
    private val startNs = System.nanoTime()
    private var lastFrameNs = 0L

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        textProgram = program(TEXT_VS, TEXT_FS)
        crtProgram = program(CRT_VS, CRT_FS)
        uRes = glGetUniformLocation(textProgram, "uRes"); uAtlas = glGetUniformLocation(textProgram, "uAtlas")
        uTex = glGetUniformLocation(crtProgram, "uTex"); uSrc = glGetUniformLocation(crtProgram, "uSrc")
        uBar = glGetUniformLocation(crtProgram, "uBar"); uFlick = glGetUniformLocation(crtProgram, "uFlick")
        uCurve = glGetUniformLocation(crtProgram, "uCurve"); uScan = glGetUniformLocation(crtProgram, "uScan"); uGlow = glGetUniformLocation(crtProgram, "uGlow")
        uBarAmt = glGetUniformLocation(crtProgram, "uBarAmt"); uTint = glGetUniformLocation(crtProgram, "uTint"); uMono = glGetUniformLocation(crtProgram, "uMono")
        drawnKey = null
        atlasTex = 0
        buildAtlas(AppGraph.carTextSize)

        val ids = IntArray(1)
        glGenBuffers(1, ids, 0); vbo = ids[0]
        fbo = 0; fboTex = 0
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        outW = width.coerceAtLeast(1); outH = height.coerceAtLeast(1)
        srcH = internalHeight
        srcW = (internalHeight * outW.toFloat() / outH).roundToInt().coerceAtLeast(64)

        val ids = IntArray(1)
        if (fbo != 0) { ids[0] = fbo; glDeleteFramebuffers(1, ids, 0) }
        if (fboTex != 0) { ids[0] = fboTex; glDeleteTextures(1, ids, 0) }
        fboTex = genTexture()
        glBindTexture(GL_TEXTURE_2D, fboTex)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, srcW, srcH, 0, GL_RGBA, GL_UNSIGNED_BYTE, null)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
        glGenFramebuffers(1, ids, 0); fbo = ids[0]
        glBindFramebuffer(GL_FRAMEBUFFER, fbo)
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, fboTex, 0)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        drawnKey = null // a new texture is empty
    }

    /** The text size the atlas was drawn at; rebuilt when the phone changes it. */
    private var builtSize = -1

    /**
     * Draw the glyphs at the chosen size: [AppGraph.carTextSize] picks how many
     * lines fill the screen (fewer lines, bigger letters). The terminal is
     * still rendered at [internalHeight] and scaled up, so bigger text keeps
     * its chunky pixels rather than going smooth.
     */
    private fun buildAtlas(size: Int) {
        builtSize = size
        val face = ResourcesCompat.getFont(context, R.font.vt323) ?: android.graphics.Typeface.MONOSPACE
        atlas = GlyphAtlas(face, internalHeight / AppGraph.CAR_TEXT_LINES[builtSize].toFloat())
        if (atlasTex != 0) { val ids = intArrayOf(atlasTex); glDeleteTextures(1, ids, 0) }
        atlasTex = genTexture()
        glBindTexture(GL_TEXTURE_2D, atlasTex)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST)
        GLUtils.texImage2D(GL_TEXTURE_2D, 0, atlas.bitmap, 0)
    }

    override fun onDrawFrame(gl: GL10?) {
        capFrameRate(paceNow())
        val editing = CarEdit.state.value.mode == Mode.EDIT && Studio.rows.value != null
        // The editor tops out at L: at XL its toolbar and tiles leave the script one row.
        val size = if (editing) minOf(AppGraph.carTextSize, 2) else AppGraph.carTextSize
        if (size != builtSize) { buildAtlas(size); drawnKey = null }
        // Seconds since start in a double: as a float it loses its fractions within
        // minutes, and anything driven by it starts to move in steps.
        val seconds = (System.nanoTime() - startNs) / 1e9
        val time = (seconds % 1000.0).toFloat()
        val key: Any = if (editing) EditKey(CarEdit.state.value, Studio.rows.value, CarEdit.drafts.value, Studio.undo.value.isEmpty(), srcW, srcH, builtSize)
        else TextKey(AppGraph.screen, ((seconds * 2).toLong() % 2).toInt(), Studio.rows.value != null, srcW, srcH, builtSize)
        if (key != drawnKey) {
            val count = if (editing) buildEdit() else buildText(AppGraph.screen, time)
            drawText(count)
            drawnKey = key
            // The cursor's blink redraws pass 1 twice a second; that alone isn't "something changing".
            val content = if (key is TextKey) key.copy(blink = 0) else key
            if (content != lastContent) { lastContent = content; lastChangeNs = System.nanoTime() }
        }

        // Pass 2: through the glass. The rolling bar's position and the flicker are
        // worked out here in double precision and handed over as small numbers —
        // computed on the GPU from the clock they stepped visibly at mediump precision.
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        glViewport(0, 0, outW, outH)
        glClearColor(0f, 0f, 0f, 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        glUseProgram(crtProgram)
        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, fboTex)
        glUniform1i(uTex, 0)
        glUniform2f(uSrc, srcW.toFloat(), srcH.toFloat())
        val look = com.jackie.dungeon.CarScreen.current
        if (lastSeconds >= 0) barPhase = (barPhase + (seconds - lastSeconds) * 0.06 * look.barSpeed) % 1.0
        lastSeconds = seconds
        glUniform1f(uBar, (1.0 - barPhase).toFloat())
        glUniform1f(uFlick, (1.0 - 0.025 * look.flicker + 0.025 * look.flicker * kotlin.math.sin((seconds * 57.0) % (2 * Math.PI))).toFloat())
        glUniform1f(uCurve, look.curve)
        glUniform1f(uScan, look.scanlines)
        glUniform1f(uGlow, look.glow)
        glUniform1f(uBarAmt, look.barBright)
        when (look.colour) {
            com.jackie.dungeon.CarScreen.Colour.GREEN -> { glUniform1f(uMono, 0f); glUniform3f(uTint, 1f, 1f, 1f) }
            com.jackie.dungeon.CarScreen.Colour.AMBER -> { glUniform1f(uMono, 1f); glUniform3f(uTint, 1.0f, 0.62f, 0.12f) }
            com.jackie.dungeon.CarScreen.Colour.WHITE -> { glUniform1f(uMono, 1f); glUniform3f(uTint, 0.92f, 0.95f, 1.0f) }
        }
        glBindBuffer(GL_ARRAY_BUFFER, 0)
        glDisableVertexAttribArray(0)
        glDrawArrays(GL_TRIANGLES, 0, 3)
    }

    private data class TextKey(val screen: Screen, val blink: Int, val tab: Boolean, val w: Int, val h: Int, val size: Int)
    private data class EditKey(val state: Any, val rows: Any?, val drafts: Any, val noUndo: Boolean, val w: Int, val h: Int, val size: Int)

    /** Pass 1: the terminal (or the editor), small, into the offscreen texture. */
    private fun drawText(count: Int) {
        glBindFramebuffer(GL_FRAMEBUFFER, fbo)
        glViewport(0, 0, srcW, srcH)
        glClearColor(0.012f, 0.035f, 0.016f, 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        glUseProgram(textProgram)
        glUniform2f(uRes, srcW.toFloat(), srcH.toFloat())
        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, atlasTex)
        glUniform1i(uAtlas, 0)
        glBindBuffer(GL_ARRAY_BUFFER, vbo)
        if (verts.capacity() < sp) verts = alloc(maxOf(sp, verts.capacity() * 2))
        verts.clear(); verts.put(stage, 0, sp); verts.position(0)
        glBufferData(GL_ARRAY_BUFFER, count * STRIDE * 4, verts, GL_STREAM_DRAW)
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE * 4, 0)
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 2, GL_FLOAT, false, STRIDE * 4, 2 * 4)
        glEnableVertexAttribArray(2); glVertexAttribPointer(2, 4, GL_FLOAT, false, STRIDE * 4, 4 * 4)
        if (count > 0) glDrawArrays(GL_TRIANGLES, 0, count)
        glDisableVertexAttribArray(1); glDisableVertexAttribArray(2)
        glDisable(GL_BLEND)
    }

    // ---- the terminal, as quads ------------------------------------------------

    private var n = 0

    /** Fills [verts] with this frame's characters; returns the vertex count. */
    private fun buildText(s: Screen, time: Float): Int {
        n = 0
        sp = 0
        val cw = atlas.cellW; val ch = atlas.cellH
        val cols = (srcW / cw - 2).coerceAtLeast(10)
        // The corner tab back to EDIT, when there's a story to edit.
        val tab = if (Studio.rows.value != null) CarView.playOverlay(viewport()) else null
        CarEdit.frame = tab
        // One row of margin shared top and bottom: the glass bends there.
        val rows = (srcH / ch - 1).coerceAtLeast(6)
        val x0 = (srcW - cols * cw) / 2f
        val y0 = ((srcH - rows * ch) / 2f).coerceAtLeast(0f)
        val dim = if (s.phase == Phase.RECONNECTING || s.phase == Phase.ON_HOLD) 0.3f else 1f

        fun row(r: Int, text: String, c: FloatArray, scale: Float = dim) {
            for ((i, chr) in text.withIndex()) {
                if (i >= cols) break
                if (chr != ' ') glyph(chr, x0 + i * cw, y0 + r * ch, cw.toFloat(), ch.toFloat(), c, scale)
            }
        }

        if (s.phase == null) {
            row(rows / 2 - 1, centre("JACKIE DUNGEON", cols), BRIGHT, 1f)
            row(rows / 2 + 1, centre("OPEN A STORY ON YOUR PHONE", cols), DIM, 1f)
            tab?.let(::draw)
            return n
        }

        // At the big text sizes the bar is ~38 columns: keep the scene's name
        // readable by giving what you carry at most half of it.
        val label = if (cols >= 60) "CARRYING: " else "+"
        val items = s.held.joinToString(", ").uppercase()
        val room = (cols / 2 - label.length - s.clock.length - 2).coerceAtLeast(4)
        val carrying = if (s.held.isEmpty()) "" else "$label${if (items.length > room) items.take(room - 1) + "…" else items}  "
        row(0, TerminalLayout.status(s.scene.uppercase(), carrying + s.clock, if (tab != null) cols - 8 else cols), DIM)
        row(1, "─".repeat(cols), RULE)

        val hints = s.keys.entries.joinToString("  ") { (k, v) -> "[$k] ${v.uppercase()}" }
        val hintRows = if (hints.isEmpty()) emptyList() else TerminalLayout.wrap(hints, cols).take(2)
        val bodyRows = rows - 2 - (if (hintRows.isEmpty()) 0 else hintRows.size + 1)
        val body = TerminalLayout.body(s.lines, cols, bodyRows)
        body.forEachIndexed { i, r -> row(2 + i, r.text, colour(r.kind, r.voice)) }

        // The cursor: after the last row, blinking.
        val typing = s.lines.any { it.shown < it.text.length }
        if ((typing || s.phase == Phase.WAITING) && ((time * 2).toInt() % 2 == 0 || typing)) {
            val last = body.lastOrNull()
            val r = 2 + (body.size - 1).coerceAtLeast(0)
            val c = (last?.text?.length ?: 0).coerceAtMost(cols - 1)
            glyph('█', x0 + c * cw, y0 + r * ch, cw.toFloat(), ch.toFloat(), BRIGHT, dim)
        }

        if (hintRows.isNotEmpty()) {
            val top = rows - hintRows.size
            row(top - 1, "─".repeat(cols), RULE)
            hintRows.forEachIndexed { i, h -> row(top + i, h, OPT) }
        }

        // Over everything: the hold and the count back in, big.
        val big = when (s.phase) {
            Phase.RECONNECTING -> listOf("RECONNECTING", "${s.countdown}")
            Phase.ON_HOLD -> listOf("ON HOLD", "")
            else -> emptyList()
        }
        if (big.isNotEmpty()) {
            val scale = 3
            big.forEachIndexed { i, text ->
                val w = text.length * cw * scale
                val x = (srcW - w) / 2f
                val y = srcH / 2f - ch * scale + i * ch * scale * 1.1f
                text.forEachIndexed { j, chr -> glyph(chr, x + j * cw * scale, y, (cw * scale).toFloat(), (ch * scale).toFloat(), BRIGHT, 1f) }
            }
        }
        tab?.let(::draw)
        return n
    }

    // ---- the editor ------------------------------------------------------------------

    private fun viewport() = Viewport(srcW.toFloat(), srcH.toFloat(), atlas.cellW.toFloat(), atlas.cellH.toFloat())

    private fun buildEdit(): Int {
        n = 0
        sp = 0
        CarEdit.render(viewport())?.let(::draw)
        return n
    }

    private fun draw(f: Frame) {
        for (op in f.ops) when (op) {
            is Op.Fill -> fill(op.x, op.y, op.w, op.h, inkOf(op.ink))
            is Op.Text -> {
                val c = inkOf(op.ink)
                op.text.forEachIndexed { i, chr -> if (chr != ' ') glyph(chr, op.x + i * atlas.cellW, op.y, atlas.cellW.toFloat(), atlas.cellH.toFloat(), c, 1f) }
            }
        }
    }

    private fun fill(x: Float, y: Float, w: Float, h: Float, rgb: FloatArray) {
        atlas.solid(uv)
        quad(x, y, w, h, uv[0], uv[1], uv[0], uv[1], rgb[0], rgb[1], rgb[2])
    }

    /** Two triangles into [stage]: no buffer calls per float, no allocation once it has grown. */
    private fun quad(x: Float, y: Float, w: Float, h: Float, u0: Float, v0: Float, u1: Float, v1: Float, r: Float, g: Float, b: Float) {
        if (sp + 6 * STRIDE > stage.size) stage = stage.copyOf(stage.size * 2)
        val a = stage
        var i = sp
        fun v(px: Float, py: Float, u: Float, vv: Float) {
            a[i] = px; a[i + 1] = py; a[i + 2] = u; a[i + 3] = vv; a[i + 4] = r; a[i + 5] = g; a[i + 6] = b; a[i + 7] = 1f; i += STRIDE
        }
        v(x, y, u0, v0); v(x + w, y, u1, v0); v(x, y + h, u0, v1)
        v(x + w, y, u1, v0); v(x + w, y + h, u1, v1); v(x, y + h, u0, v1)
        sp = i
        n += 6
    }

    private fun inkOf(i: Ink) = when (i) {
        Ink.BG, Ink.INVERSE -> BG
        Ink.PANEL -> PANEL
        Ink.RULE -> RULE
        Ink.DIM -> DIM
        Ink.FG -> VOICES[0]
        Ink.BRIGHT -> BRIGHT
        Ink.AMBER -> AMBER
        Ink.RED -> RED
        Ink.CYAN -> VOICES[1]
    }

    /**
     * Where a touch on the real screen lands on the terminal's own pixels —
     * through the same bulge the CRT pass draws with, so a tap on a curved
     * button hits the button it looks like it's on.
     */
    /** The view's size on screen, for touches; the surface itself may be drawn smaller and scaled up. 0 = same as the surface. */
    @Volatile var viewW = 0
    @Volatile var viewH = 0

    fun toSource(px: Float, py: Float): Pair<Float, Float> {
        val vw = if (viewW > 0) viewW else outW
        val vh = if (viewH > 0) viewH else outH
        var x = px / vw * 2f - 1f
        var y = (1f - py / vh) * 2f - 1f
        val k = com.jackie.dungeon.CarScreen.current.curve
        val ox = abs(y) / 7f * k; val oy = abs(x) / 6f * k
        x += x * ox * ox; y += y * oy * oy
        return (x * 0.5f + 0.5f) * srcW to (1f - (y * 0.5f + 0.5f)) * srcH
    }

    private fun centre(t: String, cols: Int) = " ".repeat(((cols - t.length) / 2).coerceAtLeast(0)) + t

    private fun glyph(c: Char, x: Float, y: Float, w: Float, h: Float, rgb: FloatArray, k: Float) {
        atlas.uv(c, uv)
        quad(x, y, w, h, uv[0], uv[1], uv[2], uv[3], rgb[0] * k, rgb[1] * k, rgb[2] * k)
    }

    private fun colour(kind: Kind, voice: Int): FloatArray = when (kind) {
        Kind.SYS, Kind.INPUT -> DIM
        Kind.HEAD, Kind.END_WIN -> BRIGHT
        Kind.OPT -> OPT
        Kind.WARN -> AMBER
        Kind.END_DEATH -> RED
        Kind.SILENT -> SILENT
        Kind.SAY -> VOICES[voice % VOICES.size]
    }

    // ---- plumbing ------------------------------------------------------------

    /** When the picture last changed: full speed for a moment after, so typing, panning and taps stay smooth. */
    private var lastChangeNs = 0L
    private var lastContent: Any? = null

    /**
     * Frames per second for the NEXT frame. Every frame runs the CRT shader over
     * every pixel of the screen, and Android Auto then encodes it as video — all
     * on the phone, which is what makes it warm. So: [fps] while something is
     * changing, a slower rate that still keeps the rolling band smooth while
     * only the glass is moving, and a crawl (enough for the cursor's blink) when
     * the band and flicker are off and nothing has changed.
     */
    private fun paceNow(): Int {
        if (System.nanoTime() - lastChangeNs < 1_500_000_000L) return fps
        val look = com.jackie.dungeon.CarScreen.current
        val glassMoves = (look.barBright > 0f && look.barSpeed > 0f) || look.flicker > 0f
        return if (glassMoves) minOf(fps, 15) else minOf(fps, 5)
    }

    private fun capFrameRate(fps: Int) {
        val budget = 1_000_000_000L / fps
        val now = System.nanoTime()
        val wait = budget - (now - lastFrameNs)
        if (lastFrameNs != 0L && wait > 0) Thread.sleep(wait / 1_000_000L, (wait % 1_000_000L).toInt())
        lastFrameNs = System.nanoTime()
    }

    private fun genTexture(): Int { val ids = IntArray(1); glGenTextures(1, ids, 0); return ids[0] }

    private fun program(vs: String, fs: String): Int {
        fun shader(type: Int, src: String): Int {
            val s = glCreateShader(type)
            glShaderSource(s, src); glCompileShader(s)
            val ok = IntArray(1); glGetShaderiv(s, GL_COMPILE_STATUS, ok, 0)
            if (ok[0] == 0) Log.e("CrtRenderer", glGetShaderInfoLog(s))
            return s
        }
        val p = glCreateProgram()
        glAttachShader(p, shader(GL_VERTEX_SHADER, vs))
        glAttachShader(p, shader(GL_FRAGMENT_SHADER, fs))
        glLinkProgram(p)
        val ok = IntArray(1); glGetProgramiv(p, GL_LINK_STATUS, ok, 0)
        if (ok[0] == 0) Log.e("CrtRenderer", glGetProgramInfoLog(p))
        return p
    }

    companion object {
        private const val STRIDE = 8
        private fun alloc(floats: Int): FloatBuffer =
            ByteBuffer.allocateDirect(floats * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()

        private fun rgb(hex: Int) = floatArrayOf(((hex shr 16) and 255) / 255f, ((hex shr 8) and 255) / 255f, (hex and 255) / 255f)
        private val BRIGHT = rgb(0xDCFFE0)
        private val BG = rgb(0x030904)
        private val PANEL = rgb(0x0A1E0F)
        private val DIM = rgb(0x4C8A55)
        private val RULE = rgb(0x1F4A27)
        private val OPT = rgb(0xC8FFD0)
        private val AMBER = rgb(0xE8D24A)
        private val RED = rgb(0xFF6B4A)
        private val SILENT = rgb(0x5FA868)
        /** Narrator, then each speaker in order of first appearance. */
        private val VOICES = arrayOf(rgb(0x8DFC9A), rgb(0x62E3D3), rgb(0xD6F56A), rgb(0xA8F0FF))

        private const val TEXT_VS = """#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in vec4 aCol;
uniform vec2 uRes;
out vec2 vUv;
out vec4 vCol;
void main() {
    vec2 n = aPos / uRes * 2.0 - 1.0;
    gl_Position = vec4(n.x, -n.y, 0.0, 1.0);
    vUv = aUv;
    vCol = aCol;
}"""

        private const val TEXT_FS = """#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vCol;
uniform sampler2D uAtlas;
out vec4 o;
void main() {
    o = vec4(vCol.rgb, vCol.a * texture(uAtlas, vUv).a);
}"""

        private const val CRT_VS = """#version 300 es
out vec2 vUv;
void main() {
    // One triangle that covers the screen.
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vUv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}"""

        private const val CRT_FS = """#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSrc;
uniform float uBar;    // where the rolling band is, 0..1, worked out on the CPU
uniform float uFlick;  // this frame's brightness, 0.95..1
uniform float uCurve;  // glass curve, 0 flat .. 2
uniform float uScan;   // scanline strength 0..1
uniform float uGlow;   // bloom 0..2
uniform float uBarAmt; // rolling band brightness 0..3
uniform vec3 uTint;    // amber or white phosphor
uniform float uMono;   // 1: one phosphor colour (amber / white), 0: the green palette as drawn
out vec4 o;

vec2 bulge(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 off = abs(uv.yx) / vec2(7.0, 6.0) * uCurve;
    uv = uv + uv * off * off;
    return uv * 0.5 + 0.5;
}

void main() {
    vec2 uv = bulge(vUv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }

    vec3 c = texture(uTex, uv).rgb;
    vec2 px = 1.0 / uSrc;
    vec3 glow = texture(uTex, uv + vec2(px.x, 0.0)).rgb + texture(uTex, uv - vec2(px.x, 0.0)).rgb
              + texture(uTex, uv + vec2(0.0, px.y)).rgb + texture(uTex, uv - vec2(0.0, px.y)).rgb
              + texture(uTex, uv + 2.0 * vec2(px.x, 0.0)).rgb + texture(uTex, uv - 2.0 * vec2(px.x, 0.0)).rgb;
    c += glow * 0.16 * uGlow;

    // Scanlines, locked to the terminal's own pixel rows.
    float line = 0.5 + 0.5 * cos(uv.y * uSrc.y * 6.2831853);
    c *= mix(1.0, mix(0.55, 1.05, line), uScan);

    // Aperture mask, in screen pixels.
    float m = mod(gl_FragCoord.x, 3.0);
    c *= m < 1.0 ? vec3(1.0, 0.9, 0.9) : (m < 2.0 ? vec3(0.9, 1.0, 0.9) : vec3(0.9, 0.9, 1.0));

    // Vignette, and corners that fall off like a tube's.
    vec2 d = uv - 0.5;
    c *= clamp(1.0 - dot(d, d) * 1.25, 0.0, 1.0);
    vec2 e = smoothstep(vec2(0.0), vec2(0.02), uv) * smoothstep(vec2(0.0), vec2(0.02), 1.0 - uv);
    c *= e.x * e.y;

    // A slow bright band rolling down, and the faintest flicker.
    float bar = 1.0 - smoothstep(0.0, 0.07, abs(uBar - uv.y));
    c += vec3(0.015, 0.05, 0.025) * bar * uBarAmt;
    c *= uFlick;

    // Amber or white tubes have one phosphor: everything in its colour, by brightness.
    if (uMono > 0.5) c = uTint * dot(c, vec3(0.3, 0.59, 0.11)) * 1.5;
    o = vec4(c, 1.0);
}"""
    }
}
