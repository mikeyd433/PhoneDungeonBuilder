package com.jackie.dungeon.audio

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * Every take becomes 8 kHz mono 16-bit PCM WAV — the port of
 * src/features/audio/ivrWav.ts, and for the same reason: Twilio's <Play>
 * accepts only mpeg / wav / aiff / gsm / ulaw, and a phone line carries
 * nothing above 4 kHz anyway. Recording at 8 kHz and shipping that file means
 * what the author hears back on the phone is what the caller will hear.
 *
 * Pure, so it is tested on the JVM: the header, a tone that must survive, and
 * one above the line's limit that must be filtered rather than fold back as
 * noise (`IvrWavTest`).
 */
object IvrWav {
    const val RATE = 8000

    /** 16-bit little-endian mono WAV, the 44-byte header ivrWav.ts writes. */
    fun encode(samples: FloatArray, rate: Int = RATE): ByteArray {
        val data = samples.size * 2
        val b = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt(36 + data); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(1)
        b.putInt(rate); b.putInt(rate * 2); b.putShort(2); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(data)
        for (x in samples) {
            val s = x.coerceIn(-1f, 1f)
            b.putShort((if (s < 0) s * 0x8000 else s * 0x7fff).toInt().toShort())
        }
        return b.array()
    }

    /** Samples back out of a WAV this file wrote (for tests and for trimming). */
    fun decode(bytes: ByteArray): Pair<FloatArray, Int> {
        val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val rate = b.getInt(24)
        val n = b.getInt(40) / 2
        return FloatArray(n) { b.getShort(44 + it * 2) / 32768f } to rate
    }

    fun durationMs(samples: Int, rate: Int = RATE) = (samples * 1000L / rate).toInt()

    /**
     * Mix to mono and resample to 8 kHz. A windowed-sinc low-pass at 3.6 kHz
     * first, so a 44.1 kHz recording's hiss and sibilance don't alias down into
     * the voice band, then linear interpolation onto the 8 kHz grid.
     */
    fun toIvr(interleaved: FloatArray, channels: Int, rate: Int): FloatArray {
        val mono = if (channels <= 1) interleaved else FloatArray(interleaved.size / channels) { i ->
            var sum = 0f
            for (c in 0 until channels) sum += interleaved[i * channels + c]
            sum / channels
        }
        if (rate == RATE) return mono
        val filtered = if (rate > RATE) lowPass(mono, rate, 3600.0) else mono
        val outLen = maxOf(1, (mono.size.toLong() * RATE / rate).toInt())
        val step = rate.toDouble() / RATE
        return FloatArray(outLen) { i ->
            val pos = i * step
            val j = floor(pos).toInt()
            val f = (pos - j).toFloat()
            val a = filtered.getOrElse(j) { 0f }
            val c = filtered.getOrElse(j + 1) { a }
            a + (c - a) * f
        }
    }

    private fun lowPass(x: FloatArray, rate: Int, cutoff: Double, taps: Int = 101): FloatArray {
        val fc = cutoff / rate
        val m = taps - 1
        val h = DoubleArray(taps) { n ->
            val k = n - m / 2.0
            val sinc = if (k == 0.0) 2 * fc else sin(2 * PI * fc * k) / (PI * k)
            val window = 0.42 - 0.5 * cos(2 * PI * n / m) + 0.08 * cos(4 * PI * n / m) // Blackman
            sinc * window
        }
        val sum = h.sum()
        for (i in h.indices) h[i] /= sum
        val half = m / 2
        return FloatArray(x.size) { i ->
            var acc = 0.0
            for (t in 0 until taps) {
                val j = i + t - half
                if (j in x.indices) acc += x[j] * h[t]
            }
            acc.toFloat()
        }
    }

    /** 16-bit PCM shorts (what AudioRecord and MediaCodec hand back) as floats. */
    fun fromPcm16(pcm: ShortArray, count: Int = pcm.size) = FloatArray(count) { pcm[it] / 32768f }

    /** A growable buffer of 16-bit samples, for a recording of unknown length. */
    class Pcm16Buffer {
        private val out = ByteArrayOutputStream()
        fun add(chunk: ShortArray, count: Int) {
            val bb = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until count) bb.putShort(chunk[i])
            out.write(bb.array())
        }
        fun floats(): FloatArray {
            val bytes = out.toByteArray()
            val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
            return FloatArray(bytes.size / 2) { b.getShort(it * 2) / 32768f }
        }
        val samples get() = out.size() / 2
    }

    /** Peak level of a chunk, 0..1, for the recording meter. */
    fun peak(chunk: ShortArray, count: Int): Float {
        var p = 0
        for (i in 0 until min(count, chunk.size)) p = maxOf(p, kotlin.math.abs(chunk[i].toInt()))
        return (p / 32768f).coerceIn(0f, 1f)
    }

}
