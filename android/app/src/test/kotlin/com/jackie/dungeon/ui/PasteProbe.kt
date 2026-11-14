package com.jackie.dungeon.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A long press in a scene's or choice's text field offers PASTE. Inside
 * Material's ModalBottomSheet it never did (the menu was simply not shown),
 * which is why [SheetFrame] is a Dialog drawn like a sheet.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PasteProbe {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private class Rec : TextToolbar {
        var paste = false
        override val status get() = if (paste) TextToolbarStatus.Shown else TextToolbarStatus.Hidden
        override fun hide() {}
        override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
            paste = paste || onPasteRequested != null
        }
    }

    @Test fun `a long press in the sheet offers paste`() {
        val rec = Rec()
        compose.activity.getSystemService(android.content.ClipboardManager::class.java)
            .setPrimaryClip(android.content.ClipData.newPlainText("x", "pasted"))
        compose.setContent {
            SheetFrame(inSheet = true, onDismiss = {}) {
                // The sheet is its own window: the toolbar has to be provided inside it.
                CompositionLocalProvider(LocalTextToolbar provides rec) {
                    var t by remember { mutableStateOf("hello world") }
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        BasicTextField(t, { t = it }, Modifier.fillMaxWidth().testTag("f"))
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        compose.onNodeWithTag("f", useUnmergedTree = true).performTouchInput { longClick(center) }
        compose.mainClock.advanceTimeBy(1000)
        assertTrue("the cut / copy / paste menu came up", rec.paste)
    }
}
