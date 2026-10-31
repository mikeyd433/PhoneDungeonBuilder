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
    private val uv = FloatArray(4)
    private val startNs = System.nanoTime()
    private var lastFrameNs = 0L

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        textProgram = program(TEXT_VS, TEXT_FS)
        crtProgram = program(CRT_VS, CRT_FS)
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
        capFrameRate()
        val editing = CarEdit.state.value.mode == Mode.EDIT && Studio.rows.value != null
        // The editor tops out at L: at XL its toolbar and tiles leave the script one row.
        val size = if (editing) minOf(AppGraph.carTextSize, 2) else AppGraph.carTextSize
        if (size != builtSize) buildAtlas(size)
        val time = ((System.nanoTime() - startNs) / 1e9f) % 1000f
        val count = if (editing) buildEdit() else buildText(AppGraph.screen, time)

        // Pass 1: the terminal, small.
        glBindFramebuffer(GL_FRAMEBUFFER, fbo)
        glViewport(0, 0, srcW, srcH)
        glClearColor(0.012f, 0.035f, 0.016f, 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        glEnable(GL_BLEND)
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
        glUseProgram(textProgram)
        glUniform2f(glGetUniformLocation(textProgram, "uRes"), srcW.toFloat(), srcH.toFloat())
        glActiveTexture(GL_TEXTURE0)
        glBindTexture(GL_TEXTURE_2D, atlasTex)
        glUniform1i(glGetUniformLocation(textProgram, "uAtlas"), 0)
        glBindBuffer(GL_ARRAY_BUFFER, vbo)
        verts.position(0)
        glBufferData(GL_ARRAY_BUFFER, count * STRIDE * 4, verts, GL_STREAM_DRAW)
        glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, false, STRIDE * 4, 0)
        glEnableVertexAttribArray(1); glVertexAttribPointer(1, 2, GL_FLOAT, false, STRIDE * 4, 2 * 4)
        glEnableVertexAttribArray(2); glVertexAttribPointer(2, 4, GL_FLOAT, false, STRIDE * 4, 4 * 4)
        if (count > 0) glDrawArrays(GL_TRIANGLES, 0, count)
        glDisableVertexAttribArray(1); glDisableVertexAttribArray(2)
        glDisable(GL_BLEND)

        // Pass 2: through the glass.
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        glViewport(0, 0, outW, outH)
        glClearColor(0f, 0f, 0f, 1f)
        glClear(GL_COLOR_BUFFER_BIT)
        glUseProgram(crtProgram)
        glBindTexture(GL_TEXTURE_2D, fboTex)
        glUniform1i(glGetUniformLocation(crtProgram, "uTex"), 0)
        glUniform2f(glGetUniformLocation(crtProgram, "uSrc"), srcW.toFloat(), srcH.toFloat())
        glUniform1f(glGetUniformLocation(crtProgram, "uTime"), time)
        glBindBuffer(GL_ARRAY_BUFFER, 0)
        glDisableVertexAttribArray(0)
        glDrawArrays(GL_TRIANGLES, 0, 3)
    }

    // ---- the terminal, as quads ------------------------------------------------

    private var n = 0

    /** Fills [verts] with this frame's characters; returns the vertex count. */
    private fun buildText(s: Screen, time: Float): Int {
        n = 0
        verts.clear()
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
        verts.clear()
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
        if (verts.remaining() < 6 * STRIDE) grow()
        fun v(px: Float, py: Float) { verts.put(px).put(py).put(uv[0]).put(uv[1]).put(rgb[0]).put(rgb[1]).put(rgb[2]).put(1f) }
        v(x, y); v(x + w, y); v(x, y + h); v(x + w, y); v(x + w, y + h); v(x, y + h)
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
    fun toSource(px: Float, py: Float): Pair<Float, Float> {
        var x = px / outW * 2f - 1f
        var y = (1f - py / outH) * 2f - 1f
        val ox = abs(y) / 7f; val oy = abs(x) / 6f
        x += x * ox * ox; y += y * oy * oy
        return (x * 0.5f + 0.5f) * srcW to (1f - (y * 0.5f + 0.5f)) * srcH
    }

    private fun centre(t: String, cols: Int) = " ".repeat(((cols - t.length) / 2).coerceAtLeast(0)) + t

    private fun glyph(c: Char, x: Float, y: Float, w: Float, h: Float, rgb: FloatArray, k: Float) {
        atlas.uv(c, uv)
        if (verts.remaining() < 6 * STRIDE) grow()
        val r = rgb[0] * k; val g = rgb[1] * k; val b = rgb[2] * k
        fun v(px: Float, py: Float, u: Float, vv: Float) { verts.put(px).put(py).put(u).put(vv).put(r).put(g).put(b).put(1f) }
        v(x, y, uv[0], uv[1]); v(x + w, y, uv[2], uv[1]); v(x, y + h, uv[0], uv[3])
        v(x + w, y, uv[2], uv[1]); v(x + w, y + h, uv[2], uv[3]); v(x, y + h, uv[0], uv[3])
        n += 6
    }

    private fun grow() {
        val bigger = alloc(verts.capacity() * 2)
        verts.flip(); bigger.put(verts); verts = bigger
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

    private fun capFrameRate() {
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
uniform float uTime;
out vec4 o;

vec2 bulge(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 off = abs(uv.yx) / vec2(7.0, 6.0);
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
    c += glow * 0.16;

    // Scanlines, locked to the terminal's own pixel rows.
    float line = 0.5 + 0.5 * cos(uv.y * uSrc.y * 6.2831853);
    c *= mix(0.55, 1.05, line);

    // Aperture mask, in screen pixels.
    float m = mod(gl_FragCoord.x, 3.0);
    c *= m < 1.0 ? vec3(1.0, 0.9, 0.9) : (m < 2.0 ? vec3(0.9, 1.0, 0.9) : vec3(0.9, 0.9, 1.0));

    // Vignette, and corners that fall off like a tube's.
    vec2 d = uv - 0.5;
    c *= clamp(1.0 - dot(d, d) * 1.25, 0.0, 1.0);
    vec2 e = smoothstep(vec2(0.0), vec2(0.02), uv) * smoothstep(vec2(0.0), vec2(0.02), 1.0 - uv);
    c *= e.x * e.y;

    // A slow bright band rolling down, and the faintest flicker.
    float bar = 1.0 - smoothstep(0.0, 0.07, abs(fract(1.0 - uTime * 0.06) - uv.y));
    c += vec3(0.015, 0.05, 0.025) * bar;
    c *= 0.975 + 0.025 * sin(uTime * 57.0);

    o = vec4(c, 1.0);
}"""
    }
}
