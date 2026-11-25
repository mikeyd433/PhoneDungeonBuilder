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
import org.junit.Assert.assertEquals
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

    @org.junit.Before fun fresh() = AppClip.forget()

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
        focusTopWindow()
        compose.onNodeWithTag("f", useUnmergedTree = true).performTouchInput { longClick(center) }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
        compose.onNodeWithText("PASTE").performClick()
        compose.waitForIdle()
        assertTrue("pasted into the field: \"$t\"", t.contains("PASTED"))
    }

    private fun focusTopWindow() {
        val wmg = Class.forName("android.view.WindowManagerGlobal")
        @Suppress("UNCHECKED_CAST")
        val views = wmg.getDeclaredField("mViews").apply { isAccessible = true }.get(wmg.getMethod("getInstance").invoke(null)) as List<android.view.View>
        // The dialog's own window — not the selection handles' popups, which a phone never focuses.
        val dialog = views.last { it.javaClass.simpleName == "DecorView" }
        compose.runOnUiThread { views.forEach { it.dispatchWindowFocusChanged(it === dialog) } }
    }

    @Test fun `a copy pastes even when Android's clipboard comes up empty`() {
        val cm = compose.activity.getSystemService(android.content.ClipboardManager::class.java)
        var b by mutableStateOf("x")
        var clip: androidx.compose.ui.platform.Clipboard? = null
        compose.setContent {
            SheetFrame(inSheet = true, onDismiss = {}) {
                clip = androidx.compose.ui.platform.LocalClipboard.current
                Column(Modifier.padding(16.dp)) { BasicTextField(b, { b = it }, Modifier.fillMaxWidth().testTag("b")) }
            }
        }
        compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
        // COPY in another field hands the words to the clipboard the fields use…
        kotlinx.coroutines.runBlocking { clip!!.setClipEntry(androidx.compose.ui.platform.ClipEntry(android.content.ClipData.newPlainText("t", "Carter: Careful now"))) }
        // …and, as on the phone, Android's has no words to give.
        cm.setPrimaryClip(android.content.ClipData.newIntent("not text", android.content.Intent()))
        focusTopWindow()
        compose.onNodeWithTag("b", useUnmergedTree = true).performTouchInput { longClick(center) }
        compose.mainClock.advanceTimeBy(100)
        focusTopWindow()
        compose.mainClock.advanceTimeBy(1000); compose.waitForIdle()
        compose.onNodeWithText("PASTE").performClick()
        compose.waitForIdle()
        assertTrue("pasted the app's copy: \"$b\"", b.contains("Carter: Careful now"))
    }

    @Test fun `the app's copy is used only when Android's clipboard didn't take it`() {
        val e = { t: String -> androidx.compose.ui.platform.ClipEntry(android.content.ClipData.newPlainText("s", t)) }
        fun picked(sys: String?) = AppClip.pick(sys?.let(e))?.clipData?.getItemAt(0)?.text.toString()
        AppClip.put(e("ours")); AppClip.systemAfterPut("old")   // the copy never reached Android's
        assertEquals("ours", picked(null))
        assertEquals("ours", picked("old"))
        assertEquals("something copied elsewhere since wins", "from Notes", picked("from Notes"))
        AppClip.put(e("ours")); AppClip.systemAfterPut("ours")  // it did reach it
        assertEquals("ours", picked("ours"))
        assertEquals("from Notes", picked("from Notes"))
    }
}
