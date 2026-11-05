package com.jackie.dungeon.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.Studio
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** The story screen as a phone shows it, without and with a car attached. PNGs in app/build/screenshots/. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class CompactBarsShot {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun shoot(name: String) {
        compose.waitForIdle()
        val v = compose.activity.window.decorView
        val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
        val out = File("build/screenshots").apply { mkdirs() }
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun story(car: Boolean, name: String, openLights: Boolean = false) {
        if (Studio.rows.value == null) Studio.stories.value.firstOrNull { it.title.startsWith("William") }?.let { Studio.open(it.id) }
        CarEdit.setPresent("car", car)
        compose.setContent { AppScreen() }
        compose.waitForIdle()
        if (openLights) compose.onNodeWithContentDescription("Show highlights").performClick()
        shoot(name)
        CarEdit.setPresent("car", false)
    }

    @Test fun phoneAlone() = story(false, "phone-no-car")
    @Test fun phoneWithCar() = story(true, "phone-with-car")
    @Test fun phoneWithCarLightsOpen() = story(true, "phone-with-car-light-up", openLights = true)
}
