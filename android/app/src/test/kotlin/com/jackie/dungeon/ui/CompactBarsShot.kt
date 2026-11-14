package com.jackie.dungeon.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTextInput
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

    @Test fun findCarter() {
        if (Studio.rows.value == null) Studio.stories.value.firstOrNull { it.title.startsWith("William") }?.let { Studio.open(it.id) }
        compose.setContent { AppScreen() }
        compose.waitForIdle()
        compose.onNodeWithText("⌕ FIND").performClick()
        compose.waitForIdle()
        compose.onNode(hasSetTextAction()).performTextInput("carter")
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1500)
        shoot("find-carter")
        compose.onNodeWithText("▼").performClick()
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1500)
        shoot("find-carter-2")
    }

    @Test fun activityLog() {
        if (Studio.rows.value == null) Studio.stories.value.firstOrNull { it.title.startsWith("William") }?.let { Studio.open(it.id) }
        val root = Studio.rows.value!!.story.rootNodeId!!
        Studio.edit("Edit script") { com.jackie.dungeon.story.StoryEditor.setScript(it, root, "Pick a player.") }
        Studio.edit("Rename choice") { r -> com.jackie.dungeon.story.StoryEditor.updateChoice(r, r.choices.first { it.fromNodeId == root }.id, label = "MIKE!") }
        compose.setContent { AppScreen() }
        compose.waitForIdle()
        shoot("activity-closed")
        compose.onNodeWithText("≡ ACTIVITY", substring = true).performClick()
        compose.waitForIdle()
        shoot("activity-open")
    }

    @Test fun storiesList() {
        Studio.close()
        compose.setContent { AppScreen() }
        compose.waitForIdle()
        shoot("stories-list")
    }

    @Test fun phoneAlone() = story(false, "phone-no-car")
    @Test fun phoneWithCar() = story(true, "phone-with-car")
    @Test fun phoneWithCarLightsOpen() = story(true, "phone-with-car-light-up", openLights = true)
}
