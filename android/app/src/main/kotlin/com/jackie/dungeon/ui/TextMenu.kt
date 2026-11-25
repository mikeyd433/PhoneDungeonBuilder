package com.jackie.dungeon.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * Cut / copy / paste, drawn by the app itself.
 *
 * A long press in a text field asks for a menu through [LocalTextToolbar]. The
 * platform's answer is a floating toolbar that, on the phone this was tested on,
 * never appeared inside the editors' windows (first Material's bottom sheet, then
 * the Dialog that replaced it) — a floating toolbar is a window of its own, and a
 * field keeps its menu only while its own window has focus. So every window here answers with this instead: a
 * row of CUT · COPY · PASTE · SELECT ALL just above what was pressed, in the
 * app's own colours. It does the same things the platform menu would — the field
 * hands over what each button does.
 */
private class TextMenu : TextToolbar {
    var rect by mutableStateOf<Rect?>(null)
    var copy by mutableStateOf<(() -> Unit)?>(null)
    var paste by mutableStateOf<(() -> Unit)?>(null)
    var cut by mutableStateOf<(() -> Unit)?>(null)
    var all by mutableStateOf<(() -> Unit)?>(null)

    override val status get() = if (rect != null) TextToolbarStatus.Shown else TextToolbarStatus.Hidden
    override fun hide() { rect = null }
    override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
        copy = onCopyRequested; paste = onPasteRequested; cut = onCutRequested; all = onSelectAllRequested
        this.rect = rect
    }
}

/** Gives everything inside it the app's own cut / copy / paste menu. One per window: the activity, and each dialog. */
@Composable
fun TextMenuHost(content: @Composable () -> Unit) {
    val menu = remember { TextMenu() }
    var host by remember { mutableStateOf<LayoutCoordinates?>(null) }
    CompositionLocalProvider(LocalTextToolbar provides menu) {
        Box(Modifier.onGloballyPositioned { host = it }, propagateMinConstraints = true) {
            content()
            // Drawn in this window, over the content — not in a popup window of its own.
            // A text field keeps its menu only while its window has focus, and a popup
            // window taking focus is enough to make the field put the menu away again.
            menu.rect?.let { r ->
                val origin = host?.takeIf { it.isAttached }?.positionInRoot() ?: Offset.Zero
                MenuLayer(r.translate(-origin)) {
                    Row(Modifier.border(1.dp, Phosphor.cyan).background(Phosphor.panel)) {
                        for ((label, act) in listOf("CUT" to menu.cut, "COPY" to menu.copy, "PASTE" to menu.paste, "SELECT ALL" to menu.all)) {
                            if (act == null) continue
                            Text(label, style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, color = Phosphor.hi),
                                modifier = Modifier.clickable { act(); if (label != "SELECT ALL") menu.hide() }.padding(horizontal = 14.dp, vertical = 10.dp))
                        }
                    }
                }
            }
        }
    }
}

/** Places the menu just above [r] (below it when there's no room above), kept inside the host. */
@Composable
private fun MenuLayer(r: Rect, content: @Composable () -> Unit) {
    Layout(content) { ms, c ->
        val p = ms.first().measure(Constraints())
        val w = c.maxWidth.takeIf { it != Constraints.Infinity } ?: c.minWidth
        val h = c.maxHeight.takeIf { it != Constraints.Infinity } ?: c.minHeight
        layout(c.minWidth, c.minHeight) {
            val gap = 12
            val x = (r.center.x - p.width / 2f).toInt().coerceIn(0, (w - p.width).coerceAtLeast(0))
            val above = r.top.toInt() - p.height - gap
            val y = (if (above >= 0) above else r.bottom.toInt() + gap).coerceIn(0, (h - p.height).coerceAtLeast(0))
            p.place(x, y, zIndex = 10f)
        }
    }
}

/** A Dialog whose text fields get [TextMenuHost]'s menu: a dialog is its own window, so the activity's doesn't reach in. */
@Composable
fun TextDialog(onDismissRequest: () -> Unit, properties: DialogProperties = DialogProperties(), content: @Composable () -> Unit) =
    Dialog(onDismissRequest = onDismissRequest, properties = properties) { TextMenuHost(content) }
