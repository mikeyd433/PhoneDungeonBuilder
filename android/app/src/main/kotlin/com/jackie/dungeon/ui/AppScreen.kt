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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import com.jackie.dungeon.story.StoryRows
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.CompositionLocalProvider
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
import com.jackie.dungeon.Backups
import com.jackie.dungeon.CloudSync
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
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
    TextMenuHost {
    Box(Modifier.fillMaxSize().background(Phosphor.bg).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            UpdateBanner()
            Box(Modifier.weight(1f)) { if (rows == null) StoriesScreen() else StoryScreen() }
        }
        error?.let { e ->
            Box(Modifier.align(Alignment.BottomCenter).padding(16.dp).fillMaxWidth().border(1.dp, Phosphor.alert).background(Phosphor.panel).clickable { Studio.clearError() }.padding(12.dp)) {
                Text("$e  (tap to dismiss)", style = mono(14, Phosphor.alert))
            }
        }
    }
    }
}

/**
 * The find bar: the words, "3 of 12", ▲ ▼ to step through them (the flowchart goes to
 * each), ✕ to close; and under it the current sighting in context — which field, which
 * scene, the words marked — a tap on it opens that scene or choice.
 */
@Composable
private fun FindBar(r: StoryRows, query: String, onQuery: (String) -> Unit, hits: List<com.jackie.dungeon.story.Find.Hit>, at: Int,
                    go: (Int) -> Unit, open: (com.jackie.dungeon.story.Find.Hit) -> Unit, close: () -> Unit) {
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.weight(1f).border(1.dp, Phosphor.cyan).background(Phosphor.bg).padding(horizontal = 10.dp, vertical = 8.dp)) {
                if (query.isEmpty()) Text("Find in this story", style = mono(15, Phosphor.dim))
                BasicTextField(query, onQuery, textStyle = mono(15), cursorBrush = SolidColor(Phosphor.fg), singleLine = true,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { go(at + 1) }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus))
            }
            Text(when { query.isBlank() -> ""; hits.isEmpty() -> "none"; else -> "${at + 1} of ${hits.size}" },
                style = mono(13, if (query.isNotBlank() && hits.isEmpty()) Phosphor.alert else Phosphor.dim))
            for ((label, by) in listOf("▲" to -1, "▼" to 1)) Text(label, style = mono(18, if (hits.isEmpty()) Phosphor.line else Phosphor.fg),
                modifier = Modifier.border(1.dp, Phosphor.line).clickable(enabled = hits.isNotEmpty()) { go(at + by) }.padding(horizontal = 10.dp, vertical = 4.dp))
            Text("✕", style = mono(18, Phosphor.dim), modifier = Modifier.clickable { close() }.padding(horizontal = 8.dp, vertical = 4.dp))
        }
        hits.getOrNull(at)?.let { h ->
            val (line, a, b) = com.jackie.dungeon.story.Find.snippet(h, 56)
            val where = h.where.label.uppercase() + " · " + sceneName(r, h.nodeId) + (h.choiceId?.let { id -> r.choices.firstOrNull { it.id == id }?.let { " · choice ${it.digit}" } } ?: "")
            Column(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable { open(h) }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                Text("$where  ·  tap to open", style = mono(11, Phosphor.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(androidx.compose.ui.text.buildAnnotatedString {
                    append(line)
                    addStyle(androidx.compose.ui.text.SpanStyle(background = Phosphor.warn, color = Phosphor.bg), a, b)
                }, style = mono(13), maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/**
 * The cloud copy of this story changed so much since the last sync (most scenes
 * rewritten or gone at once) that merging it would quietly undo this phone's work.
 * Nothing syncs for it until you choose.
 */
@Composable
private fun HeldBanner(storyId: String, viewer: Boolean) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).border(2.dp, Phosphor.warn).background(Phosphor.panel).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("SYNC PAUSED FOR THIS STORY", style = mono(13, Phosphor.warn))
        Text("The cloud copy is very different from the one on this phone — most scenes changed at once, which is what happens when another phone's copy replaces it. " +
            "Nothing has been changed here. Choose which copy to keep. (Backing it up first, from the stories list, is a good idea.)", style = mono(12, Phosphor.fg))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!viewer) Text("KEEP THIS PHONE'S", style = mono(13, Phosphor.bg), modifier = Modifier.weight(1f).background(Phosphor.fg)
                .clickable { CloudSync.keepPhone(storyId) }.padding(horizontal = 8.dp, vertical = 8.dp))
            Text(if (confirm) "TAP AGAIN: REPLACE THIS PHONE'S" else "TAKE THE CLOUD'S", style = mono(13, if (confirm) Phosphor.bg else Phosphor.warn),
                modifier = Modifier.weight(1f).border(1.dp, Phosphor.warn).background(if (confirm) Phosphor.warn else Phosphor.panel)
                    .clickable { if (confirm) CloudSync.takeCloud(storyId) else confirm = true }.padding(horizontal = 8.dp, vertical = 8.dp))
        }
    }
}

/** A newer build is on Play: say so, at the top of every phone screen, until it's installed or waved off. */
@Composable
private fun UpdateBanner() {
    val st by com.jackie.dungeon.Updates.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current as? PhoneActivity
    val (words, action, act) = when (val u = st) {
        com.jackie.dungeon.Updates.State.None -> return
        is com.jackie.dungeon.Updates.State.Available -> Triple("A new version of the app is out.", "UPDATE") { activity?.let { com.jackie.dungeon.Updates.start(it.updateLauncher) }; Unit }
        is com.jackie.dungeon.Updates.State.Downloading -> Triple("Downloading the update… ${u.percent}%", null) { }
        com.jackie.dungeon.Updates.State.Ready -> Triple("The update is ready.", "RESTART") { com.jackie.dungeon.Updates.install() }
    }
    Row(Modifier.fillMaxWidth().background(Phosphor.warn).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(words, style = mono(13, Phosphor.bg), modifier = Modifier.weight(1f))
        if (action != null) Text(action, style = mono(14, Phosphor.warn), modifier = Modifier.background(Phosphor.bg).clickable { act() }.padding(horizontal = 12.dp, vertical = 6.dp))
        if (st is com.jackie.dungeon.Updates.State.Available) Text("LATER", style = mono(13, Phosphor.bg), modifier = Modifier.clickable { com.jackie.dungeon.Updates.dismiss() }.padding(6.dp))
    }
}

/** "v0.32.0 (32)": the version name, and the Play version code it was uploaded as. */
fun appVersion(context: android.content.Context): String = runCatching {
    val p = context.packageManager.getPackageInfo(context.packageName, 0)
    "v${p.versionName} (${androidx.core.content.pm.PackageInfoCompat.getLongVersionCode(p)})"
}.getOrDefault("")

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

@Composable
private fun StoriesScreen() {
    val stories by Studio.stories.collectAsStateWithLifecycle()
    var naming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var opened by remember { mutableStateOf<Backups.Opened?>(null) }
    var stamp by remember { mutableStateOf(0) } // re-reads the "backed up" lines after a backup
    fun backUp(ids: List<String>) {
        busy = if (ids.size == 1) "Backing up…" else "Backing up ${ids.size} stories…"
        scope.launch {
            val files = withContext(Dispatchers.IO) {
                runCatching { ids.mapNotNull { Studio.load(it) }.map { Backups.make(context, it) } }
            }
            busy = null; stamp++
            files.onSuccess { if (it.isNotEmpty()) Backups.share(context, it) }.onFailure { Studio.reportError("The backup failed: ${it.message}") }
        }
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = "Reading the backup…"
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching { Backups.open(context, uri) } }
            busy = null
            r.onSuccess { opened = it }.onFailure { Studio.reportError(it.message ?: "That file couldn't be read.") }
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Text("JACKIE DUNGEON", style = style(32, Phosphor.hi), modifier = Modifier.weight(1f))
            // Which build this is, so an update can be seen to have gone through.
            Text(remember { appVersion(context) }, style = mono(13, Phosphor.cyan), modifier = Modifier.padding(bottom = 6.dp))
        }
        Text("Your stories, on this phone.", style = mono(13, Phosphor.dim))
        SyncBar(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(stories, key = { it.id }) { s ->
                Row(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable { Studio.open(s.id) }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(s.title.ifBlank { "Untitled story" }, style = style(24, Phosphor.fg), maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("${s.scenes} scenes", style = mono(12, Phosphor.dim))
                        val last = remember(s.id, stamp) { Backups.lastBackup(context, s.id) }
                        Text(if (last == 0L) "never backed up" else "backed up " + android.text.format.DateUtils.getRelativeTimeSpanString(last),
                            style = mono(12, if (last == 0L || System.currentTimeMillis() - last > 7L * 86_400_000) Phosphor.warn else Phosphor.dim))
                    }
                    Text("back up", style = mono(12, Phosphor.cyan), modifier = Modifier.clickable { backUp(listOf(s.id)) }.padding(8.dp))
                    Text("delete", style = mono(12, Phosphor.dim), modifier = Modifier.clickable { deleting = s.id }.padding(8.dp))
                }
            }
        }
        busy?.let { Text(it, style = mono(13, Phosphor.cyan)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button("BACK UP ALL", Modifier.weight(1f)) { backUp(stories.map { it.id }) }
            Button("RESTORE…", Modifier.weight(1f)) { pick.launch(arrayOf("application/zip", "application/octet-stream", "application/x-zip-compressed", "*/*")) }
        }
        Button("+ NEW STORY", Modifier.fillMaxWidth(), primary = true) { naming = true }
    }
    opened?.let { o -> RestoreDialog(o, onDone = { opened = null }) }
    if (naming) AskText("Name the new story", "Create") { t -> naming = false; if (t != null) Studio.create(t) }
    deleting?.let { id ->
        val title = stories.firstOrNull { it.id == id }?.title ?: ""
        val role = CloudSync.roles.collectAsStateWithLifecycle().value[id]
        val question = when {
            !CloudSync.inCloud(id) -> "Delete \"$title\" from this phone? This can't be undone."
            role == null || role == "owner" -> "Delete \"$title\"? It's deleted in the cloud too, for everyone it's shared with. This can't be undone."
            else -> "Leave \"$title\"? It's removed from this phone and you're taken off the shared story; it stays for everyone else."
        }
        Confirm(question, if (role == null || role == "owner") "Delete" else "Leave") { yes -> deleting = null; if (yes) Studio.deleteStory(id) }
    }
}

/** What's in the backup, and — when this phone has the same story — replace it or keep both. */
@Composable
private fun RestoreDialog(o: Backups.Opened, onDone: () -> Unit) {
    val context = LocalContext.current
    val m = o.manifest
    val here = remember(o) { Studio.exists(o.rows.story.id) }
    val scope = rememberCoroutineScope()
    fun go(asCopy: Boolean) {
        scope.launch {
            // Copying the takes is file work: off the main thread, then open the story.
            withContext(Dispatchers.IO) { runCatching { Backups.restore(context, o, asCopy) } }
                .onSuccess { Studio.install(it); if (!asCopy && here) com.jackie.dungeon.CloudSync.hold(it.story.id) }.onFailure { Studio.reportError("The restore failed: ${it.message}") }
            onDone()
        }
    }
    TextDialog(onDismissRequest = onDone) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("RESTORE “${m.title.ifBlank { "Untitled story" }.uppercase()}”", style = style(22, Phosphor.hi))
            Text("${m.scenes} scenes · ${m.takes} recordings · saved ${m.savedAt}", style = mono(13, Phosphor.dim))
            if (m.missingTakes > 0) Text("${m.missingTakes} recordings were already missing when it was backed up.", style = mono(12, Phosphor.warn))
            if (here) {
                Text("This phone already has this story. Replace it with the backup, or keep both?", style = mono(14, Phosphor.fg))
                Button("REPLACE THE ONE HERE", Modifier.fillMaxWidth()) { go(asCopy = false) }
                Button("KEEP BOTH", Modifier.fillMaxWidth(), primary = true) { go(asCopy = true) }
                Button("CANCEL", Modifier.fillMaxWidth()) { onDone() }
            } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { onDone() }
                Button("RESTORE", Modifier.weight(1f), primary = true) { go(asCopy = false) }
            }
        }
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
    var managing by remember { mutableStateOf(false) }
    var recordings by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    val roles by CloudSync.roles.collectAsStateWithLifecycle()
    val people by CloudSync.people.collectAsStateWithLifecycle()
    val carPresent by CarEdit.present.collectAsStateWithLifecycle()
    val heldIds by CloudSync.held.collectAsStateWithLifecycle()
    LaunchedEffect(r.story.id) { CloudSync.activityFor(r.story.id) }
    // FIND, like a browser's: the words, every place they are, and which one is current.
    var finding by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var at by remember { mutableStateOf(0) }
    val findLayout = remember(r) { com.jackie.dungeon.story.FlowLayout.layout(r) }
    val hits = remember(r, query, finding) { if (finding) com.jackie.dungeon.story.Find.find(r, query, findLayout) else emptyList() }
    val foundScenes = remember(hits) { hits.mapTo(HashSet()) { it.nodeId } }
    // New words: start at the first sighting, and go there.
    LaunchedEffect(query, finding) {
        at = 0
        hits.firstOrNull()?.let { h -> selected = h.nodeId; jump = h.nodeId + "#" + System.nanoTime() }
    }
    if (at >= hits.size && hits.isNotEmpty()) at = hits.size - 1

    // The car's mode mirrors the tab: EDIT shows the map, PLAY the terminal. And the
    // other way: switching on the car (its EDIT tab, PLAY MODE) switches the phone.
    LaunchedEffect(tab) { CarEdit.setMode(if (tab == "play") com.jackie.dungeon.car.Mode.PLAY else com.jackie.dungeon.car.Mode.EDIT) }
    val carMode = CarEdit.mode.collectAsStateWithLifecycle().value
    var seenMode by remember { mutableStateOf<com.jackie.dungeon.car.Mode?>(null) }
    LaunchedEffect(carMode) {
        // Only a CHANGE on the car moves the tab; the first value is the car catching up with the phone.
        if (seenMode != null && seenMode != carMode) tab = if (carMode == com.jackie.dungeon.car.Mode.PLAY) "play" else "edit"
        seenMode = carMode
    }

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
            Focus.Map -> { scene = null; choice = null }
        }
    }
    // The car's page mirrors the open sheet: a scene's page while one is open, the map once it closes.
    var hadSheet by remember { mutableStateOf(false) }
    LaunchedEffect(scene, choice) {
        when {
            scene != null -> CarEdit.followScene(scene!!)
            choice != null -> CarEdit.followChoice(choice!!)
            hadSheet -> CarEdit.sheetClosed()
        }
        hadSheet = scene != null || choice != null
    }

    BackHandler { if (tab == "play") tab = "edit" else Studio.close() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("◄", style = style(26, Phosphor.fg), modifier = Modifier.clickable { Studio.close() }.padding(6.dp))
            Text(r.story.title.ifBlank { "Untitled story" }, style = style(24, Phosphor.hi), maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).clickable { renaming = true })
            Text("SHARE", style = style(20, Phosphor.fg),
                modifier = Modifier.border(1.dp, Phosphor.line).clickable { sharing = true }.padding(horizontal = 10.dp, vertical = 4.dp))
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
        if (r.story.id in heldIds) HeldBanner(r.story.id, viewer = roles[r.story.id] == "viewer")
        if (roles[r.story.id] == "viewer") Text("VIEW ONLY · shared with you to look at: changes made here aren't saved to the cloud, and the next sync puts the shared version back.",
            style = mono(12, Phosphor.warn), modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp))
        val sync by CloudSync.status.collectAsStateWithLifecycle()
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (undo.isNotEmpty() && tab == "edit") Text("Undo: ${undo.last().first}", style = mono(11, Phosphor.dim), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            else Box(Modifier.weight(1f))
            val (line, color) = syncLine(sync)
            val here = people.map { it.name }.distinct()
            Text("☁ " + line + (if (here.isEmpty()) "" else " · on now: " + here.joinToString(", ")), style = mono(11, if (here.isEmpty()) color else Phosphor.warn),
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        }

        val chapters = remember(r) { StoryEditor.chapters(r) }
        val moved = StoryEditor.hasNudges(r) || r.story.layoutHome.isNotEmpty()
        if (tab == "edit" && finding) FindBar(r, query, { query = it }, hits, at,
            go = { i -> if (hits.isNotEmpty()) { at = ((i % hits.size) + hits.size) % hits.size; hits[at].let { h -> selected = h.nodeId; jump = h.nodeId + "#" + System.nanoTime() } } },
            open = { h -> if (h.choiceId != null) { scene = null; choice = h.choiceId } else { choice = null; scene = h.nodeId } },
            close = { finding = false; query = "" })
        if (tab == "edit") {
            // Jump to a chapter's lane: its first scene, near the top of the screen.
            // ALL fits the whole story; a chapter fits its lane, from the top.
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("⌕ FIND", style = mono(13, if (finding) Phosphor.bg else Phosphor.cyan), modifier = Modifier.border(1.dp, Phosphor.cyan)
                    .background(if (finding) Phosphor.cyan else Phosphor.bg).clickable { finding = !finding; if (!finding) query = "" }.padding(horizontal = 10.dp, vertical = 6.dp))
                Text("♪ RECORDINGS", style = mono(13, Phosphor.cyan), modifier = Modifier.border(1.dp, Phosphor.cyan).clickable { recordings = true }.padding(horizontal = 10.dp, vertical = 6.dp))
                // With a car attached, its controls ride in this row: LIGHT UP folds open into its checkboxes.
                // (The phone's EDIT / PLAY tabs are the car's modes too, so no switch for those.)
                if (carPresent) CarChips()
                if (chapters.isNotEmpty()) for ((key, label) in listOf("all" to "ALL") + chapters.map { "chapter:$it" to (if ('/' in it) "› " + it.substringAfterLast('/') else it) }) {
                    Text(label, style = mono(13, Phosphor.fg), modifier = Modifier.border(1.dp, Phosphor.line).clickable {
                        jump = key + "#" + System.nanoTime()
                    }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
                // The arrangement: save the one on screen as the default, go back to
                // the default, or drop every move for the automatic layout.
                if (chapters.isNotEmpty()) Text("CHAPTERS…", style = mono(13, Phosphor.cyan), modifier = Modifier.border(1.dp, Phosphor.cyan).clickable { managing = true }.padding(horizontal = 10.dp, vertical = 6.dp))
                if (StoryEditor.layoutChanged(r)) {
                    Text("SAVE AS DEFAULT", style = mono(13, Phosphor.cyan), modifier = Modifier.border(1.dp, Phosphor.cyan).clickable {
                        Studio.edit("Save layout as default") { StoryEditor.saveLayoutAsDefault(it) }
                    }.padding(horizontal = 10.dp, vertical = 6.dp))
                    Text(if (r.story.layoutHome.isEmpty()) "RESET LAYOUT" else "BACK TO DEFAULT", style = mono(13, Phosphor.warn), modifier = Modifier.border(1.dp, Phosphor.line).clickable {
                        Studio.edit("Reset layout") { StoryEditor.resetLayout(it) }
                    }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
                if (r.story.layoutHome.isNotEmpty()) Text("AUTO LAYOUT", style = mono(13, Phosphor.dim), modifier = Modifier.border(1.dp, Phosphor.line).clickable {
                    Studio.edit("Automatic layout") { StoryEditor.autoLayout(it) }
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
                    onView = { cx, cy, vw, vh -> CarEdit.phoneView(com.jackie.dungeon.car.PhoneView(cx, cy, vw, vh)) },
                    others = people.filter { it.sceneId != null }.groupBy({ it.sceneId!! }, { it.name }),
                    find = if (finding) query else "", found = foundScenes, foundNow = hits.getOrNull(at)?.nodeId,
                    onNudge = { target, dx, dy ->
                        if (target.startsWith("chapter:")) Studio.edit("Move ${target.removePrefix("chapter:")}") { StoryEditor.nudgeChapter(it, target.removePrefix("chapter:"), dx, dy) }
                        else Studio.edit("Move scene") { StoryEditor.nudgeScene(it, target, dx, dy) }
                    },
                )
                Legend(Modifier.align(Alignment.BottomStart))
                ActivityPanel(r, Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = 40.dp)) { id ->
                    selected = id; jump = id + "#" + System.nanoTime()
                }
            } else PlayScreen()
        }
    }

    // While FIND is open, the sheets mark the words in their fields too.
    CompositionLocalProvider(LocalFind provides (if (finding) query else "")) {
    scene?.let { id ->
        SceneSheet(r, id, onClose = { scene = null }, onChoice = { scene = null; choice = it },
            onPlay = { sid -> scene = null; AppGraph.playFrom(Studio.packOf(r, startAt = sid)); tab = "play" },
            onGo = { sid -> scene = null; selected = sid; jump = sid })
    }
    choice?.let { id ->
        ChoiceSheet(r, id, onClose = { choice = null }, onGo = { sid -> choice = null; selected = sid; jump = sid })
    }
    }
    if (exporting) ExportDialog(r) { exporting = false }
    if (managing) ChaptersDialog(r) { managing = false }
    if (recordings) RecordingsDialog(r, onGo = { id -> recordings = false; selected = id; jump = id + "#" + System.nanoTime(); scene = id }) { recordings = false }
    if (sharing) ShareDialog(r.story.id, r.story.title.ifBlank { "Untitled story" }) { sharing = false }
    PlayHereDialog()
    if (renaming) AskText("Name this story", "Rename", r.story.title) { t -> renaming = false; if (t != null) Studio.edit("Rename story") { StoryEditor.setStoryTitle(it, t) } }
}

/**
 * The activity log, folded into a tab in the flowchart's bottom-right corner:
 * who changed what, newest first ("Carter · Edit script · Player Select · 3 min
 * ago"). Opened, a tap on an entry goes to its scene. A count on the tab says how
 * many edits other people made since it was last opened.
 */
@Composable
private fun ActivityPanel(r: StoryRows, modifier: Modifier, go: (String) -> Unit) {
    val log by CloudSync.activity.collectAsStateWithLifecycle()
    var open by rememberSaveable { mutableStateOf(false) }
    var seenAt by rememberSaveable(r.story.id) { mutableStateOf(System.currentTimeMillis()) }
    val me = CloudSync.myId()
    val theirs = log.count { it.userId != null && it.userId != me && it.at.toEpochMilli() > seenAt }
    // Re-reads "3 min ago" every half minute while open.
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(open) { while (open) { kotlinx.coroutines.delay(30_000); tick++ } }
    if (!open) {
        Text("≡ ACTIVITY" + if (theirs > 0) "  • $theirs" else "", style = mono(12, if (theirs > 0) Phosphor.bg else Phosphor.cyan),
            modifier = modifier.border(1.dp, Phosphor.cyan).background(if (theirs > 0) Phosphor.warn else Phosphor.bg)
                .clickable { open = true; seenAt = System.currentTimeMillis() }.padding(horizontal = 10.dp, vertical = 6.dp))
        return
    }
    Column(modifier.widthIn(max = 320.dp).heightIn(max = 340.dp).border(1.dp, Phosphor.cyan).background(Phosphor.bg)) {
        Row(Modifier.fillMaxWidth().background(Phosphor.panel).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ACTIVITY", style = mono(12, Phosphor.cyan), modifier = Modifier.weight(1f))
            Text("✕", style = mono(16, Phosphor.dim), modifier = Modifier.clickable { open = false; seenAt = System.currentTimeMillis() }.padding(horizontal = 6.dp))
        }
        if (log.isEmpty()) Text("No edits yet. Changes made here, and by anyone this story is shared with, show up here.",
            style = mono(12, Phosphor.dim), modifier = Modifier.padding(10.dp))
        LazyColumn(Modifier.fillMaxWidth()) {
            items(log.size) { i ->
                val e = log[i]
                val who = if (e.userId == null || e.userId == me) "You" else e.name
                val scene = e.sceneId?.let { id -> r.nodes.firstOrNull { it.id == id } }
                val ago = tick.let {
                    if (System.currentTimeMillis() - e.at.toEpochMilli() < 60_000) "just now"
                    else android.text.format.DateUtils.getRelativeTimeSpanString(e.at.toEpochMilli(), System.currentTimeMillis(), android.text.format.DateUtils.MINUTE_IN_MILLIS).toString()
                }
                Column(Modifier.fillMaxWidth().clickable(enabled = scene != null) { scene?.let { go(it.id) } }.padding(horizontal = 10.dp, vertical = 6.dp)) {
                    Text("$who · ${e.label}", style = mono(13, if (who == "You") Phosphor.fg else Phosphor.warn), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text((scene?.let { (it.title.ifBlank { it.slug }) + " · " } ?: (if (e.sceneId != null) "a deleted scene · " else "")) + ago,
                        style = mono(11, if (scene != null) Phosphor.cyan else Phosphor.dim), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
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
    // Follows the newest line until you scroll up to read something again; then it stays
    // put while the story carries on below, until you scroll back down or tap LATEST.
    var follow by remember { mutableStateOf(true) }
    LaunchedEffect(list) {
        list.interactionSource.interactions.collect { if (it is androidx.compose.foundation.interaction.DragInteraction.Start) follow = false }
    }
    LaunchedEffect(list) {
        androidx.compose.runtime.snapshotFlow { list.isScrollInProgress to list.canScrollForward }.collect { (moving, more) -> if (!moving && !more) follow = true }
    }
    LaunchedEffect(lines.size, lines.lastOrNull()?.shown, follow) { if (follow && lines.isNotEmpty()) list.scrollToItem(lines.size - 1, Int.MAX_VALUE) }

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
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                Modifier.fillMaxSize().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable { AppGraph.tapScreen() }.padding(10.dp),
                state = list, verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(lines.size) { i -> TranscriptLine(lines[i]) }
            }
            if (!follow) Text("▼ LATEST", style = style(18, Phosphor.bg),
                modifier = Modifier.align(Alignment.BottomCenter).padding(8.dp).background(Phosphor.warn).clickable { follow = true }.padding(horizontal = 14.dp, vertical = 6.dp))
        }
        Keypad(Modifier.fillMaxWidth().height(260.dp), compact = true)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CarTextSize(Modifier.weight(1f))
            CarSettingsLink()
        }
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
    TextDialog(onDismissRequest = { onDone(null) }) {
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
    TextDialog(onDismissRequest = { onDone(false) }) {
        Column(Modifier.border(1.dp, Phosphor.alert).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(question, style = mono(15, Phosphor.hi))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { onDone(false) }
                Button(action.uppercase(), Modifier.weight(1f), primary = true) { onDone(true) }
            }
        }
    }
}
