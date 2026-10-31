package com.jackie.dungeon

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.util.Log
import com.jackie.dungeon.audio.IvrWav
import java.io.File
import java.nio.ByteOrder

/**
 * Takes: recorded with the mic, or brought in as a file — either way ending up
 * as an 8 kHz mono WAV ([IvrWav]), the only shape Twilio's Play is sure of.
 *
 * Recording runs at 44.1 kHz (the one rate every Android phone must support)
 * and is converted on stop. A take shorter than half a second is thrown away:
 * an accidental tap reads as a recorded scene and plays as silence, which is
 * worse than no take at all.
 */
object Takes {
    private const val TAG = "Takes"
    private const val RATE = 44100
    private const val MIN_MS = 500

    /** Where a story's takes live. Kept until the story is deleted, so undo can bring one back. */
    fun file(context: Context, storyId: String, name: String): File {
        val dir = File(context.filesDir, "audio/$storyId").apply { mkdirs() }
        val slug = name.uppercase().replace(Regex("[^A-Z0-9]+"), "_").trim('_').take(40).ifEmpty { "TAKE" }
        return File(dir, "${slug}-${System.currentTimeMillis()}.wav")
    }

    // ---- recording -----------------------------------------------------------------

    @Volatile var level = 0f; private set
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var thread: Thread? = null
    private var buffer = IvrWav.Pcm16Buffer()

    val recording get() = running

    /** Needs RECORD_AUDIO, which the take row asks for first. */
    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (running) return true
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return false
        val r = try {
            AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, RATE / 5 * 2))
        } catch (e: Exception) { Log.w(TAG, "mic", e); return false }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
        buffer = IvrWav.Pcm16Buffer()
        record = r
        running = true
        r.startRecording()
        thread = Thread({
            val chunk = ShortArray(2048)
            while (running) {
                val n = r.read(chunk, 0, chunk.size)
                if (n > 0) { buffer.add(chunk, n); level = IvrWav.peak(chunk, n) }
            }
        }, "jackie-mic").apply { start() }
        return true
    }

    /**
     * Stop and write the take to [out]. Returns its length in ms, or null when
     * it was too short to keep. Slow-ish (it filters and resamples), so call it
     * off the main thread.
     */
    fun stop(out: File): Int? {
        running = false
        thread?.join(1000); thread = null
        record?.let { runCatching { it.stop() }; it.release() }; record = null
        level = 0f
        val samples = buffer.floats()
        if (samples.size * 1000L / RATE < MIN_MS) return null
        val ivr = IvrWav.toIvr(samples, 1, RATE)
        out.writeBytes(IvrWav.encode(ivr))
        return IvrWav.durationMs(ivr.size)
    }

    fun cancel() {
        running = false
        thread?.join(1000); thread = null
        record?.let { runCatching { it.stop() }; it.release() }; record = null
        level = 0f
    }

    // ---- importing a finished file --------------------------------------------------

    /** Decode any audio Android can read, and write it to [out] as an 8 kHz WAV. Returns ms. */
    fun import(context: Context, uri: Uri, out: File): Int {
        val ex = MediaExtractor()
        try {
            ex.setDataSource(context, uri, null)
            val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
                ?: error("That file has no audio in it.")
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(format, null, null, 0)
            codec.start()
            val pcm = IvrWav.Pcm16Buffer()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            while (!outputDone) {
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val buf = codec.getInputBuffer(i)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) { codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inputDone = true }
                        else { codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0); ex.advance() }
                    }
                }
                when (val o = codec.dequeueOutputBuffer(info, 10_000)) {
                    MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    }
                    else -> if (o >= 0) {
                        val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.LITTLE_ENDIAN)
                        val shorts = ShortArray(info.size / 2)
                        buf.position(info.offset); buf.asShortBuffer().get(shorts)
                        pcm.add(shorts, shorts.size)
                        codec.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
            codec.stop(); codec.release()
            val ivr = IvrWav.toIvr(pcm.floats(), channels, rate)
            if (ivr.isEmpty()) error("That file is silent.")
            out.writeBytes(IvrWav.encode(ivr))
            return IvrWav.durationMs(ivr.size)
        } finally {
            ex.release()
        }
    }

    // ---- hearing a take back --------------------------------------------------------

    private var preview: MediaPlayer? = null
    @Volatile var previewing: String? = null; private set

    fun play(path: String, onDone: () -> Unit) {
        stopPreview()
        val p = MediaPlayer()
        try {
            p.setDataSource(path)
            p.setOnCompletionListener { stopPreview(); onDone() }
            p.prepare(); p.start()
            preview = p; previewing = path
        } catch (e: Exception) {
            Log.w(TAG, "preview", e); p.release(); onDone()
        }
    }

    fun stopPreview() {
        preview?.let { runCatching { it.stop() }; it.release() }
        preview = null; previewing = null
    }
}
