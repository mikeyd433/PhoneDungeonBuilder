package com.jackie.dungeon.ui

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.jackie.dungeon.story.StoryRows
import com.jackie.dungeon.story.StoryEditor
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.unit.dp
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
@Config(sdk = [35], qualifiers = "w411dp-h1400dp-xxhdpi")
class ScreenshotTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val william = StoryRows.parse(File("../engine/src/test/resources/golden/william.rows.json").readText())

    private fun shoot(name: String) {
        compose.waitForIdle()
        // Draw the window ourselves: captureToImage waits for a frame Robolectric never sends.
        val v = compose.activity.window.decorView
        val bmp = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
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
        compose.setContent { Box(Modifier.fillMaxSize().background(Phosphor.bg)) { ChoiceSheet(william, door, onClose = {}, onGo = {}, inSheet = false) } }
        compose.waitForIdle()
        shoot("choice-sheet")
    }

    @Test fun choiceSheetWithAFork() {
        val door = william.gates.first { it.failBehavior == "divert" }.choiceId
        compose.setContent { Box(Modifier.fillMaxSize().background(Phosphor.bg)) { ChoiceSheet(william, door, onClose = {}, onGo = {}, inSheet = false) } }
        compose.waitForIdle()
        shoot("choice-sheet-fork")
    }

    @Test fun sceneSheet() {
        val room = william.nodes.first { it.slug == "PRESS_1_TO_BUY" }.id
        compose.setContent { Box(Modifier.fillMaxSize().background(Phosphor.bg)) { SceneSheet(william, room, onClose = {}, onChoice = {}, onPlay = {}, onGo = {}, inSheet = false) } }
        compose.waitForIdle()
        shoot("scene-sheet")
    }

    @Test fun chaptersAsLanes() {
        var r = william
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "GNOME_RUNS_BY_AND" }.id), "Mike")
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "CARTER_INTRO_0" }.id), "Carter")
        compose.setContent {
            Column(Modifier.fillMaxSize().background(Phosphor.bg)) {
                Text("HEADER ABOVE THE CHART", style = style(26, Phosphor.hi), modifier = Modifier.fillMaxWidth().background(Phosphor.panel).padding(16.dp))
                Box(Modifier.weight(1f)) {
                    Flowchart(r, selected = null, focus = {}, onScene = {}, onChoice = {}, onAddChoice = {}, onPlayFrom = {}, startScale = 0.105f)
                }
                Text("FOOTER BELOW THE CHART", style = style(26, Phosphor.hi), modifier = Modifier.fillMaxWidth().background(Phosphor.panel).padding(16.dp))
            }
        }
        compose.waitForIdle()
        shoot("chapters-lanes")
    }

    @Test fun subChapters() {
        var r = william
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "GNOME_RUNS_BY_AND" }.id), "Mike")
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, r.nodes.first { it.slug == "CARTER_INTRO_0" }.id), "Carter")
        val mike = r.nodes.filter { it.chapter == "Mike" }.map { it.id }.toSet()
        val split = mike.first { id -> StoryEditor.onward(r, id).count { it in mike } >= 2 }
        val (a, b) = StoryEditor.onward(r, split).filter { it in mike }.take(2)
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, a), "Mike/Path A")
        r = StoryEditor.setChapter(r, StoryEditor.branchOf(r, b), "Mike/Path B")
        compose.setContent {
            Box(Modifier.fillMaxSize().background(Phosphor.bg)) {
                Flowchart(r, selected = null, focus = {}, onScene = {}, onChoice = {}, onAddChoice = {}, onPlayFrom = {}, startScale = 0.14f)
            }
        }
        compose.waitForIdle()
        shoot("sub-chapters")
    }
}
