package com.jackie.dungeon.audio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class IvrWavTest {
    private fun tone(hz: Double, rate: Int, seconds: Double, channels: Int = 1) =
        FloatArray((rate * seconds).toInt() * channels) { i -> (0.5 * sin(2 * PI * hz * (i / channels) / rate)).toFloat() }

    private fun rms(x: FloatArray, from: Int = x.size / 10, to: Int = x.size * 9 / 10): Double {
        var s = 0.0; for (i in from until to) s += x[i] * x[i]; return sqrt(s / (to - from))
    }

    @Test
    fun `the header is the one Twilio reads - 8 kHz, mono, 16-bit PCM`() {
        val wav = IvrWav.encode(FloatArray(8000))
        val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("RIFF", String(wav, 0, 4)); assertEquals("WAVE", String(wav, 8, 4)); assertEquals("data", String(wav, 36, 4))
        assertEquals(1, b.getShort(20).toInt(), "PCM")
        assertEquals(1, b.getShort(22).toInt(), "mono")
        assertEquals(8000, b.getInt(24))
        assertEquals(16, b.getShort(34).toInt())
        assertEquals(44 + 16000, wav.size)
        assertEquals(36 + 16000, b.getInt(4))
    }

    @Test
    fun `a voice-band tone survives the trip from 44_1 kHz stereo`() {
        val out = IvrWav.toIvr(tone(1000.0, 44100, 1.0, channels = 2), channels = 2, rate = 44100)
        assertTrue(abs(out.size - 8000) <= 1, "one second is 8000 samples, got ${out.size}")
        val level = rms(out)
        assertTrue(level in 0.30..0.40, "1 kHz should keep its level (0.354), got $level")
    }

    @Test
    fun `a tone above the phone line's limit is filtered, not folded back`() {
        // 6 kHz would alias to 2 kHz at 8 kHz — right in the voice band — without the filter.
        val out = IvrWav.toIvr(tone(6000.0, 48000, 1.0), channels = 1, rate = 48000)
        assertTrue(rms(out) < 0.02, "6 kHz should be gone, got ${rms(out)}")
    }

    @Test
    fun `round trip through the file keeps the samples`() {
        val x = tone(440.0, 8000, 0.25)
        val (back, rate) = IvrWav.decode(IvrWav.encode(x))
        assertEquals(8000, rate)
        assertEquals(x.size, back.size)
        assertTrue(x.indices.all { abs(x[it] - back[it]) < 1e-3f })
        assertEquals(250, IvrWav.durationMs(x.size))
    }
}
