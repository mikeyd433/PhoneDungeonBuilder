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
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard
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
    // Only what is drawn is state: where, and which buttons. A text field asks again on
    // every recomposition while its selection is up, each time with new lambdas; were
    // those state, every ask would redraw the host, which recomposes the field, which
    // asks again — for ever.
    var rect by mutableStateOf<Rect?>(null)
    var items by mutableStateOf<List<String>>(emptyList())
    private var acts: Map<String, () -> Unit> = emptyMap()

    fun run(label: String) = acts[label]?.invoke()

    override val status get() = if (rect != null) TextToolbarStatus.Shown else TextToolbarStatus.Hidden
    override fun hide() { if (rect != null) rect = null }
    override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
        acts = buildMap {
            onCutRequested?.let { put("CUT", it) }; onCopyRequested?.let { put("COPY", it) }
            onPasteRequested?.let { put("PASTE", it) }; onSelectAllRequested?.let { put("SELECT ALL", it) }
        }
        val labels = listOf("CUT", "COPY", "PASTE", "SELECT ALL").filter { it in acts }
        if (items != labels) items = labels
        if (this.rect != rect) this.rect = rect
    }
}

/** Gives everything inside it the app's own cut / copy / paste menu. One per window: the activity, and each dialog. */
@Composable
fun TextMenuHost(content: @Composable () -> Unit) {
    val menu = remember { TextMenu() }
    // Not state: it's set on every layout pass, and a state write there recomposes the
    // host, which re-runs the text field, which asks for the menu again, which lays out…
    val host = remember { arrayOfNulls<LayoutCoordinates>(1) }
    val platform = LocalClipboard.current
    val clipboard = remember(platform) { AppClipboard(platform) }
    CompositionLocalProvider(LocalTextToolbar provides menu, LocalClipboard provides clipboard) {
        Box(Modifier.onGloballyPositioned { host[0] = it }, propagateMinConstraints = true) {
            content()
            // Drawn in this window, over the content — not in a popup window of its own.
            // A text field keeps its menu only while its window has focus, and a popup
            // window taking focus is enough to make the field put the menu away again.
            menu.rect?.let { r ->
                val origin = host[0]?.takeIf { it.isAttached }?.positionInRoot() ?: Offset.Zero
                MenuLayer(r.translate(-origin)) {
                    Row(Modifier.border(1.dp, Phosphor.cyan).background(Phosphor.panel)) {
                        for (label in menu.items) {
                            Text(label, style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, color = Phosphor.hi),
                                modifier = Modifier.clickable { menu.run(label); if (label != "SELECT ALL") menu.hide() }.padding(horizontal = 14.dp, vertical = 10.dp))
                        }
                    }
                }
            }
        }
    }
}

/**
 * What was last cut or copied in this app, kept by the app as well as handed to
 * Android. On the phone it was tested on, a copy never reached Android's clipboard
 * (nothing in the keyboard's clipboard list) and the app couldn't read one back,
 * so the menu never offered PASTE. Android only lets a focused app use the
 * clipboard, and with a second screen for the car the phone's window isn't
 * always the focused one. Kept here, the app's own copy pastes whatever Android
 * says — unless something newer has been copied in another app since.
 */
object AppClip {
    @Volatile var entry: ClipEntry? = null; private set
    /** What Android's clipboard held just after the app's copy (null: nothing it would give). */
    @Volatile private var systemAfter: String? = null

    fun put(e: ClipEntry?) { entry = e; systemAfter = null }
    fun systemAfterPut(text: String?) { systemAfter = text }
    fun forget() { entry = null; systemAfter = null }

    private fun ClipEntry?.text(): String? = this?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()

    /**
     * What PASTE gives: Android's clipboard, unless it still holds just what it held
     * right after the app's copy — then the copy never reached it, and the app's own
     * is the one meant. Anything copied elsewhere since has changed Android's, so it
     * wins. (Change listeners can't tell: Android only sends them to the app on screen.)
     */
    fun pick(system: ClipEntry?): ClipEntry? {
        val ours = entry ?: return system
        val sys = system.text() ?: return ours
        return if (sys == systemAfter && sys != ours.text()) ours else system
    }
}

private class AppClipboard(private val platform: Clipboard) : Clipboard {
    override suspend fun getClipEntry(): ClipEntry? = AppClip.pick(runCatching { platform.getClipEntry() }.getOrNull())
    override suspend fun setClipEntry(clipEntry: ClipEntry?) {
        if (clipEntry != null) AppClip.put(clipEntry)
        runCatching { platform.setClipEntry(clipEntry) }.onFailure { android.util.Log.w("TextMenu", "clipboard", it) }
        if (clipEntry != null) AppClip.systemAfterPut(runCatching { platform.getClipEntry() }.getOrNull()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString())
    }
    override val nativeClipboard get() = platform.nativeClipboard
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
