package com.jackie.dungeon.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.jackie.dungeon.story.StoryRows
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders the editor's screens on the JVM and writes PNGs to
 * app/build/screenshots/, so the flowchart can be looked at without a phone.
 * It checks that they draw, not how they look — the pictures are for people.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val william = StoryRows.parse(File("../engine/src/test/resources/golden/william.rows.json").readText())

    private fun shoot(name: String) {
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val out = File("build/screenshots").apply { mkdirs() }
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun flowchart() {
        compose.setContent {
            Box(Modifier.fillMaxSize().background(Phosphor.bg)) {
                Flowchart(william, selected = william.story.rootNodeId, focus = {}, onScene = {}, onChoice = {}, onAddChoice = {}, onPlayFrom = {})
            }
        }
        compose.waitForIdle()
        shoot("flowchart")
    }

    @Test fun flowchartAtTheFork() {
        val swamp = william.nodes.first { it.slug == "PRESS_1_TO_BUY" }.id
        compose.setContent {
            Box(Modifier.fillMaxSize().background(Phosphor.bg)) {
                Flowchart(william, selected = swamp, jumpTo = swamp, focus = {}, onScene = {}, onChoice = {}, onAddChoice = {}, onPlayFrom = {})
            }
        }
        compose.waitForIdle()
        shoot("flowchart-fork")
    }

    @Test fun choiceSheet() {
        val door = william.choices.first { it.label == "Offer Helmet" }.id
        compose.setContent { Box(Modifier.fillMaxSize().background(Phosphor.bg)) { ChoiceSheet(william, door, onClose = {}, onGo = {}) } }
        compose.waitForIdle()
        shoot("choice-sheet")
    }

    @Test fun sceneSheet() {
        val room = william.nodes.first { it.slug == "PRESS_1_TO_BUY" }.id
        compose.setContent { Box(Modifier.fillMaxSize().background(Phosphor.bg)) { SceneSheet(william, room, onClose = {}, onChoice = {}, onPlay = {}, onGo = {}) } }
        compose.waitForIdle()
        shoot("scene-sheet")
    }
}
