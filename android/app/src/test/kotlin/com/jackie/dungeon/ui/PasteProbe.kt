package com.jackie.dungeon.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A long press in a scene's or choice's text field brings up the app's own
 * CUT / COPY / PASTE bar ([TextMenuHost]) — and PASTE really pastes. Neither
 * Material's bottom sheet nor a plain Dialog showed the platform's menu on the
 * phone, so this drives the app's menu end to end rather than a stand-in.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// Android 8.1: the press-and-hold loupe (API 28+) crashes inside Robolectric's popup windows.
@Config(sdk = [27])
class PasteProbe {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun `a long press in the editor offers paste, and paste pastes`() {
        compose.activity.getSystemService(android.content.ClipboardManager::class.java)
            .setPrimaryClip(android.content.ClipData.newPlainText("x", "PASTED"))
        var t by mutableStateOf("hello world")
        compose.setContent {
            SheetFrame(inSheet = true, onDismiss = {}) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                    BasicTextField(t, { t = it }, Modifier.fillMaxWidth().testTag("f"))
                }
            }
        }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        // On a phone the dialog's window has focus once it's up; the test's windows never
        // get it, and a text field only keeps its menu in a focused window. Give it.
        @Suppress("UNCHECKED_CAST")
        val wmg = Class.forName("android.view.WindowManagerGlobal")
        val views = wmg.getDeclaredField("mViews").apply { isAccessible = true }.get(wmg.getMethod("getInstance").invoke(null)) as List<android.view.View>
        compose.runOnUiThread { views.forEach { it.dispatchWindowFocusChanged(it === views.last()) } }
        compose.waitForIdle()
        compose.onNodeWithTag("f", useUnmergedTree = true).performTouchInput { longClick(center) }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        compose.onNodeWithText("PASTE").performClick()
        compose.waitForIdle()
        assertTrue("pasted into the field: \"$t\"", t.contains("PASTED"))
    }
}
