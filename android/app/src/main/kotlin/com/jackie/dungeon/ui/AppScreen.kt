package com.jackie.dungeon.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.car.Focus
import com.jackie.dungeon.Studio
import com.jackie.dungeon.call.CallSession
import com.jackie.dungeon.call.CallSession.Kind
import com.jackie.dungeon.call.CallSession.Phase
import com.jackie.dungeon.story.StoryEditor

/**
 * The phone app: the stories on this phone, and one story at a time with two
 * tabs — EDIT (the flowchart) and PLAY (a phone-sized call). The car screen
 * plays whichever story is open here.
 */
@Composable
fun AppScreen() {
    val rows by Studio.rows.collectAsStateWithLifecycle()
    val error by Studio.error.collectAsStateWithLifecycle()
    Box(Modifier.fillMaxSize().background(Phosphor.bg).safeDrawingPadding()) {
        if (rows == null) StoriesScreen() else StoryScreen()
        error?.let { e ->
            Box(Modifier.align(Alignment.BottomCenter).padding(16.dp).fillMaxWidth().border(1.dp, Phosphor.alert).background(Phosphor.panel).clickable { Studio.clearError() }.padding(12.dp)) {
                Text("$e  (tap to dismiss)", style = mono(14, Phosphor.alert))
            }
        }
    }
}

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

@Composable
private fun StoriesScreen() {
    val stories by Studio.stories.collectAsStateWithLifecycle()
    var naming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("JACKIE DUNGEON", style = style(32, Phosphor.hi))
        Text("Your stories, on this phone.", style = mono(13, Phosphor.dim))
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(stories, key = { it.id }) { s ->
                Row(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable { Studio.open(s.id) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.title.ifBlank { "Untitled story" }, style = style(24, Phosphor.fg), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${s.scenes} scenes", style = mono(12, Phosphor.dim))
                    }
                    Text("delete", style = mono(12, Phosphor.dim), modifier = Modifier.clickable { deleting = s.id }.padding(8.dp))
                }
            }
        }
        Button("+ NEW STORY", Modifier.fillMaxWidth(), primary = true) { naming = true }
    }
    if (naming) AskText("Name the new story", "Create") { t -> naming = false; if (t != null) Studio.create(t) }
    deleting?.let { id ->
        val title = stories.firstOrNull { it.id == id }?.title ?: ""
        Confirm("Delete \"$title\" from this phone? This can't be undone.", "Delete") { yes -> deleting = null; if (yes) Studio.deleteStory(id) }
    }
}

@Composable
private fun StoryScreen() {
    val rows by Studio.rows.collectAsStateWithLifecycle()
    val undo by Studio.undo.collectAsStateWithLifecycle()
    val r = rows ?: return
    var tab by rememberSaveable { mutableStateOf("edit") }
    var scene by remember { mutableStateOf<String?>(null) }
    var choice by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }
    var jump by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    val carPresent by CarEdit.present.collectAsStateWithLifecycle()

    // In step with the car: what it opens, this opens; what this opens, it goes to.
    val focus by CarEdit.focus.collectAsStateWithLifecycle()
    var handled by rememberSaveable { mutableStateOf(CarEdit.focus.value?.second ?: 0L) }
    LaunchedEffect(focus) {
        val (f, at) = focus ?: return@LaunchedEffect
        if (at == handled) return@LaunchedEffect
        handled = at
        tab = "edit"
        when (f) {
            is Focus.Scene -> { choice = null; scene = f.id; selected = f.id; jump = f.id + "#" + at }
            is Focus.Choice -> { scene = null; choice = f.id }
        }
    }
    LaunchedEffect(scene) { scene?.let(CarEdit::followScene) }
    LaunchedEffect(choice) { choice?.let(CarEdit::followChoice) }

    BackHandler { if (tab == "play") tab = "edit" else Studio.close() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("◄", style = style(26, Phosphor.fg), modifier = Modifier.clickable { Studio.close() }.padding(6.dp))
            Text(r.story.title.ifBlank { "Untitled story" }, style = style(24, Phosphor.hi), maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).clickable { renaming = true })
            Text("EXPORT", style = style(20, Phosphor.fg),
                modifier = Modifier.border(1.dp, Phosphor.line).clickable { exporting = true }.padding(horizontal = 10.dp, vertical = 4.dp))
            Text("UNDO", style = style(20, if (undo.isEmpty()) Phosphor.line else Phosphor.fg),
                modifier = Modifier.border(1.dp, Phosphor.line).clickable(enabled = undo.isNotEmpty()) { Studio.undo() }.padding(horizontal = 10.dp, vertical = 4.dp))
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
            for ((k, t) in listOf("edit" to "EDIT", "play" to "PLAY")) {
                Box(Modifier.weight(1f).border(1.dp, Phosphor.line).background(if (tab == k) Phosphor.fg else Phosphor.panel).clickable { tab = k }.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    Text(t, style = style(22, if (tab == k) Phosphor.bg else Phosphor.dim))
                }
            }
        }
        if (carPresent) CarControls(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp))
        if (undo.isNotEmpty() && tab == "edit") Text("Undo: ${undo.last().first}", style = mono(11, Phosphor.dim), modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp))

        val chapters = remember(r) { StoryEditor.chapters(r) }
        if (tab == "edit" && chapters.isNotEmpty()) {
            // Jump to a chapter's lane: its first scene, near the top of the screen.
            // ALL fits the whole story; a chapter fits its lane, from the top.
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((key, label) in listOf("all" to "ALL") + chapters.map { "chapter:$it" to it }) {
                    Text(label, style = mono(13, Phosphor.fg), modifier = Modifier.border(1.dp, Phosphor.line).clickable {
                        jump = key + "#" + System.nanoTime()
                    }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
                if (StoryEditor.hasNudges(r)) Text("RESET LAYOUT", style = mono(13, Phosphor.warn), modifier = Modifier.border(1.dp, Phosphor.line).clickable {
                    Studio.edit("Reset layout") { StoryEditor.resetLayout(it) }
                }.padding(horizontal = 10.dp, vertical = 6.dp))
            }
        }
        Box(Modifier.weight(1f)) {
            if (tab == "edit") {
                Flowchart(
                    rows = r, selected = selected, jumpTo = jump,
                    focus = { selected = it; jump = it },
                    onScene = { selected = it; scene = it },
                    onChoice = { choice = it },
                    onAddChoice = { id ->
                        selected = id
                        Studio.editWith("Add choice") { StoryEditor.addChoice(it, id, newScene = true) }?.let { choice = it }
                    },
                    onPlayFrom = { id -> AppGraph.playFrom(Studio.packOf(r, startAt = id)); tab = "play" },
                    onNudge = { target, dx, dy ->
                        if (target.startsWith("chapter:")) Studio.edit("Move ${target.removePrefix("chapter:")}") { StoryEditor.nudgeChapter(it, target.removePrefix("chapter:"), dx, dy) }
                        else Studio.edit("Move scene") { StoryEditor.nudgeScene(it, target, dx, dy) }
                    },
                )
                Legend(Modifier.align(Alignment.BottomStart))
            } else PlayScreen()
        }
    }

    scene?.let { id ->
        SceneSheet(r, id, onClose = { scene = null }, onChoice = { scene = null; choice = it },
            onPlay = { sid -> scene = null; AppGraph.playFrom(Studio.packOf(r, startAt = sid)); tab = "play" },
            onGo = { sid -> scene = null; selected = sid; jump = sid })
    }
    choice?.let { id ->
        ChoiceSheet(r, id, onClose = { choice = null }, onGo = { sid -> choice = null; selected = sid; jump = sid })
    }
    if (exporting) ExportDialog(r) { exporting = false }
    PlayHereDialog()
    if (renaming) AskText("Name this story", "Rename", r.story.title) { t -> renaming = false; if (t != null) Studio.edit("Rename story") { StoryEditor.setStoryTitle(it, t) } }
}

@Composable
private fun Legend(modifier: Modifier) {
    Text(
        "◇ needs an item  + gives  “ reply  ↺ loops  ? nowhere yet · pinch to zoom · hold and drag to move a scene or a chapter",
        style = mono(10, Phosphor.dim),
        modifier = modifier.fillMaxWidth().background(Phosphor.bg.copy(alpha = 0.85f)).padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/**
 * Playing on the phone: a readable transcript and a big keypad. Simpler than
 * the car's CRT, on purpose — it is read at arm's length, often while editing.
 * While this tab is open the call is "showing", so it runs; leave it and the
 * call holds, exactly as it does when the car screen goes.
 */
@Composable
private fun PlayScreen() {
    val ui by AppGraph.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current
    DisposableEffect(Unit) {
        AppGraph.setShowing("phone", true)
        onDispose { AppGraph.setShowing("phone", false) }
    }
    val list = rememberLazyListState()
    val lines = ui.lines.filter { it.shown > 0 || it.text.isEmpty() }
    LaunchedEffect(lines.size, lines.lastOrNull()?.shown) { if (lines.isNotEmpty()) list.scrollToItem(lines.size - 1) }

    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(ui.scene.uppercase(), style = style(20, Phosphor.dim), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(ui.clock, style = style(20, Phosphor.dim))
        }
        if (ui.held.isNotEmpty()) Text("CARRYING: " + ui.held.joinToString(", "), style = mono(12, Phosphor.dim))
        if (ui.edited) Text("You edited the story · REDIAL to hear the new version", style = mono(12, Phosphor.warn))
        when (ui.phase) {
            Phase.RECONNECTING -> Text("RECONNECTING ${ui.countdown}", style = style(22, Phosphor.warn))
            Phase.ON_HOLD -> Text("ON HOLD", style = style(22, Phosphor.warn))
            else -> Unit
        }
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable { AppGraph.tapScreen() }.padding(10.dp),
            state = list, verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(lines.size) { i -> TranscriptLine(lines[i]) }
        }
        Keypad(Modifier.fillMaxWidth().height(260.dp), compact = true)
        CarTextSize(Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("REDIAL", Modifier.weight(1f)) { AppGraph.redial() }
            Button("CAR PREVIEW", Modifier.weight(1f)) {
                context.startActivity(Intent(context, CarActivity::class.java).putExtra(CarActivity.EXTRA_PREVIEW, true))
            }
        }
    }
}

@Composable
private fun TranscriptLine(l: CallSession.Line) {
    val text = l.text.take(l.shown.coerceAtLeast(0))
    val color = when (l.kind) {
        Kind.SYS, Kind.INPUT -> Phosphor.dim
        Kind.HEAD, Kind.END_WIN -> Phosphor.hi
        Kind.OPT -> Phosphor.hi
        Kind.WARN -> Phosphor.warn
        Kind.END_DEATH -> Phosphor.alert
        Kind.SILENT -> Phosphor.fg.copy(alpha = 0.7f)
        Kind.SAY -> listOf(Phosphor.fg, Phosphor.cyan, Color(0xFFD6F56A), Color(0xFFA8F0FF))[l.voice % 4]
    }
    Text(text, style = mono(if (l.kind == Kind.HEAD) 16 else 15, color))
}

@Composable
fun AskText(title: String, action: String, initial: String = "", onDone: (String?) -> Unit) {
    var text by remember { mutableStateOf(initial) }
    Dialog(onDismissRequest = { onDone(null) }) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = mono(17, Phosphor.hi))
            Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).padding(10.dp)) {
                BasicTextField(text, { text = it }, textStyle = mono(16), cursorBrush = SolidColor(Phosphor.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { onDone(null) }
                Button(action.uppercase(), Modifier.weight(1f), primary = true) { onDone(text.trim()) }
            }
        }
    }
}

@Composable
fun Confirm(question: String, action: String, onDone: (Boolean) -> Unit) {
    Dialog(onDismissRequest = { onDone(false) }) {
        Column(Modifier.border(1.dp, Phosphor.alert).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(question, style = mono(15, Phosphor.hi))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { onDone(false) }
                Button(action.uppercase(), Modifier.weight(1f), primary = true) { onDone(true) }
            }
        }
    }
}
