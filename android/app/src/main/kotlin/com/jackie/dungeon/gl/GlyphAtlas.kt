package com.jackie.dungeon.gl

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import kotlin.math.ceil

/**
 * Every character the terminal can show, drawn once into a bitmap at the
 * renderer's internal resolution.
 *
 * Drawn at the size it will be shown — the terminal is rendered small and the
 * CRT pass scales it up — so each glyph is a crisp block of pixels rather than
 * a smoothed vector, which is half of what makes it read as a 1980s screen.
 * Anything not in [CHARS] is drawn as `?`.
 */
class GlyphAtlas(typeface: Typeface, textPx: Float) {
    val bitmap: Bitmap
    val cellW: Int
    val cellH: Int
    private val index = HashMap<Char, Int>()
    private val columns = 16
    /** Empty pixels around each cell, so nearest-neighbour sampling at a cell's
     *  edge never picks up the descender of the glyph next door. */
    private val pad = 2
    private val pitchW get() = cellW + pad * 2
    private val pitchH get() = cellH + pad * 2

    init {
        val paint = Paint().apply {
            this.typeface = typeface
            textSize = textPx
            color = Color.WHITE
            isAntiAlias = false
        }
        val fm = paint.fontMetrics
        cellW = ceil(paint.measureText("M")).toInt().coerceAtLeast(1)
        cellH = ceil(fm.descent - fm.ascent).toInt().coerceAtLeast(1)
        val rows = (CHARS.length + columns - 1) / columns
        bitmap = Bitmap.createBitmap(columns * pitchW, rows * pitchH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        CHARS.forEachIndexed { i, c ->
            index[c] = i
            val x = (i % columns) * pitchW + pad
            val y = (i / columns) * pitchH + pad - fm.ascent
            canvas.drawText(c.toString(), x.toFloat(), y, paint)
        }
    }

    /** Texture coordinates of [c]: u0, v0, u1, v1. */
    fun uv(c: Char, out: FloatArray) {
        val i = index[c] ?: index['?']!!
        val w = bitmap.width.toFloat()
        val h = bitmap.height.toFloat()
        out[0] = ((i % columns) * pitchW + pad) / w
        out[1] = ((i / columns) * pitchH + pad) / h
        out[2] = out[0] + cellW / w
        out[3] = out[1] + cellH / h
    }

    companion object {
        val CHARS: String = buildString {
            for (c in 32..126) append(c.toChar())
            append("—–·×↺…“”‘’■▣□◇◆♪✕◎█▒░─│")
        }
    }
}
