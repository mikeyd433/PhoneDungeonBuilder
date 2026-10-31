package com.jackie.dungeon

import android.app.Application
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Plays one take at a time from the story's public audio links.
 *
 * MediaPlayer lives on the main looper so its callbacks have somewhere to
 * land; the worker only ever asks it to start or stop. [onDone] fires once per
 * take, finished or failed, so the call never waits forever on a dead link.
 */
class AudioPlayer(app: Application, private val onDone: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val audioManager = app.getSystemService(AudioManager::class.java)
    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_GAME)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .build()
    private var player: MediaPlayer? = null

    @Volatile var playing = false
        private set

    /** False when there is nothing playable at [url] — a storage path rather than a link. */
    fun play(url: String): Boolean {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false
        playing = true
        main.post {
            release()
            audioManager.requestAudioFocus(focus)
            val p = MediaPlayer()
            player = p
            try {
                p.setAudioAttributes(attrs)
                p.setDataSource(url)
                p.setOnPreparedListener { it.start() }
                p.setOnCompletionListener { finish() }
                p.setOnErrorListener { _, what, extra -> Log.w("AudioPlayer", "error $what/$extra on $url"); finish(); true }
                p.prepareAsync()
            } catch (e: Exception) {
                Log.w("AudioPlayer", "could not play $url", e)
                finish()
            }
        }
        return true
    }

    fun stop() {
        main.post {
            val was = playing
            release()
            playing = false
            if (was) onDone()
        }
    }

    private fun finish() {
        release()
        playing = false
        onDone()
    }

    private fun release() {
        player?.let { runCatching { it.reset(); it.release() } }
        player = null
        audioManager.abandonAudioFocusRequest(focus)
    }
}
