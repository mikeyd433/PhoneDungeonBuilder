package com.jackie.dungeon

import android.app.Application
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * How the car screen looks and behaves, set from the phone (CAR SCREEN
 * SETTINGS) and applied live: the renderer reads [current] every frame, so a
 * slider moves the car screen as it is dragged. Kept between runs.
 */
object CarScreen {

    enum class Colour(val label: String) { GREEN("Green"), AMBER("Amber"), WHITE("White") }

    data class Settings(
        /** How much wider than the phone's view the mirrored map shows. */
        val mirrorMargin: Float = 1.35f,
        /** How far above the phone's middle the mirrored map centres, as a share of its height. */
        val mirrorLift: Float = 0.08f,
        /** Glass curve: 0 flat, 1 as designed, 2 twice as bowed. */
        val curve: Float = 1f,
        /** Scanline strength, 0 none to 1 full. */
        val scanlines: Float = 1f,
        /** Bloom around the letters. */
        val glow: Float = 1f,
        /** Brightness of the rolling band; 0 hides it. */
        val barBright: Float = 1f,
        /** How fast the band rolls; 1 is one pass every ~17 seconds. */
        val barSpeed: Float = 1f,
        /** Flicker; 0 steady. */
        val flicker: Float = 1f,
        val colour: Colour = Colour.GREEN,
        /** How fast PLAY types the story out, in characters a second. */
        val typing: Float = 40f,
    )

    private lateinit var app: Application

    private val _settings = MutableStateFlow(Settings())
    val settings: StateFlow<Settings> = _settings

    /** For the GL thread and the call's clock. */
    @Volatile var current = Settings()
        private set

    fun init(application: Application) {
        app = application
        val p = app.getSharedPreferences("car_screen", Context.MODE_PRIVATE)
        val d = Settings()
        set(Settings(
            mirrorMargin = p.getFloat("mirrorMargin", d.mirrorMargin), mirrorLift = p.getFloat("mirrorLift", d.mirrorLift),
            curve = p.getFloat("curve", d.curve), scanlines = p.getFloat("scanlines", d.scanlines), glow = p.getFloat("glow", d.glow),
            barBright = p.getFloat("barBright", d.barBright), barSpeed = p.getFloat("barSpeed", d.barSpeed), flicker = p.getFloat("flicker", d.flicker),
            colour = runCatching { Colour.valueOf(p.getString("colour", d.colour.name)!!) }.getOrDefault(d.colour), typing = p.getFloat("typing", d.typing),
        ), save = false)
    }

    fun set(s: Settings, save: Boolean = true) {
        current = s
        _settings.value = s
        CarEdit.mirrorSettings(s.mirrorMargin, s.mirrorLift)
        if (save && ::app.isInitialized) app.getSharedPreferences("car_screen", Context.MODE_PRIVATE).edit()
            .putFloat("mirrorMargin", s.mirrorMargin).putFloat("mirrorLift", s.mirrorLift).putFloat("curve", s.curve).putFloat("scanlines", s.scanlines)
            .putFloat("glow", s.glow).putFloat("barBright", s.barBright).putFloat("barSpeed", s.barSpeed).putFloat("flicker", s.flicker)
            .putString("colour", s.colour.name).putFloat("typing", s.typing).apply()
    }

    fun update(f: (Settings) -> Settings) = set(f(current))

    fun reset() = set(Settings())
}
