package com.jackie.dungeon.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.Studio
import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows

private val mono = FontFamily.Monospace
private fun body(size: Int = 15, color: Color = Phosphor.fg) = TextStyle(fontFamily = mono, fontSize = size.sp, color = color)
private fun label() = TextStyle(fontFamily = mono, fontSize = 11.sp, color = Phosphor.dim, letterSpacing = 1.sp)

@Composable
private fun Field(name: String, value: String, onChange: (String) -> Unit, lines: Int = 1, hint: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(name.uppercase(), style = label())
        Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.bg).padding(10.dp)) {
            if (value.isEmpty() && hint.isNotEmpty()) Text(hint, style = body(color = Phosphor.dim))
            BasicTextField(
                value, onChange, textStyle = body(), cursorBrush = SolidColor(Phosphor.fg),
                singleLine = lines == 1, minLines = lines, modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun Chip(text: String, on: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.border(1.dp, if (on) Phosphor.fg else Phosphor.line)
            .background(if (on) Phosphor.fg else Phosphor.panel)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) { Text(text, style = body(14, if (on) Phosphor.bg else if (enabled) Phosphor.fg else Phosphor.line)) }
}

@Composable
private fun LinkRow(name: String, value: String, valueColor: Color = Phosphor.fg, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(name.uppercase(), style = label())
        Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.bg).padding(10.dp)) {
            Text("$value  ›", style = body(color = valueColor), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun SheetButtons(vararg buttons: Pair<String, () -> Unit>, danger: Set<String> = emptySet()) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((t, f) in buttons) {
            Box(
                Modifier.weight(1f).border(1.dp, if (t in danger) Phosphor.alert else Phosphor.line).background(Phosphor.panel).clickable(onClick = f).padding(vertical = 12.dp),
                contentAlignment = androidx.compose.ui.Alignment.Center,
            ) { Text(t, style = body(14, if (t in danger) Phosphor.alert else Phosphor.fg)) }
        }
    }
}

/** A bottom sheet on the phone; a plain panel where there's no room for one to pop up (tests). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetFrame(inSheet: Boolean, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    if (inSheet) ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Phosphor.panel) { content() }
    else Box(Modifier.background(Phosphor.panel)) { content() }
}

fun sceneName(rows: StoryRows, id: String?): String =
    rows.nodes.firstOrNull { it.id == id }?.let { it.title.ifBlank { it.slug } } ?: "nowhere yet"

// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SceneSheet(rows: StoryRows, id: String, onClose: () -> Unit, onChoice: (String) -> Unit, onPlay: (String) -> Unit, onGo: (String) -> Unit, inSheet: Boolean = true) {
    val n = rows.nodes.firstOrNull { it.id == id } ?: return onClose()
    var title by remember(id) { mutableStateOf(n.title) }
    var script by remember(id) { mutableStateOf(n.narration) }
    var confirmDelete by remember(id) { mutableStateOf(false) }
    val kind = if (n.nodeType == "ending") (n.endingKind ?: "death") else "room"
    val save = {
        if (title != n.title) Studio.edit("Rename scene") { StoryEditor.updateScene(it, id, title = title) }
        if (script != n.narration) Studio.edit("Edit script") { StoryEditor.setScript(it, id, script) }
    }
    // The car can open something else while this is open: keep what was typed.
    val latestSave by rememberUpdatedState(save)
    DisposableEffect(id) { onDispose { latestSave(); CarEdit.clearDrafts() } }
    SheetFrame(inSheet, onDismiss = { save(); onClose() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(if (id == rows.story.rootNodeId) "START SCENE" else "SCENE", style = label())
            Field("Name", title, { title = it; CarEdit.draft("title:$id", it) }, hint = "Name this scene")
            ChapterPicker(rows, id) { save() }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("ENDS THE CALL?", style = label())
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((k, t) in listOf("room" to "No", "death" to "Death", "win" to "Win")) Chip(t, kind == k) { Studio.edit("Change ending") { StoryEditor.updateScene(it, id, kind = k) } }
                }
            }
            Field("Script · \"Name: line\" for a speaker", script, { script = it; CarEdit.draft("script:$id", it) }, lines = 5, hint = "What the caller hears in this scene")
            val lines = rows.dialogueLines.filter { it.nodeId == id }.sortedBy { it.sortOrder }
            if (lines.isNotEmpty()) Text("Split into ${lines.size} speaker lines. They follow the script when you edit it.", style = body(12, Phosphor.dim))
            else if (script.contains(':')) Text("Split by speaker", style = body(13, Phosphor.cyan), modifier = Modifier.clickable { save(); Studio.edit("Split by speaker") { StoryEditor.splitIntoLines(it, nodeId = id) } })

            Text("RECORDING", style = label())
            TakeRow("The whole scene, one take", n.audioPath, n.audioDurationMs, n.slug) { path, ms ->
                save(); Studio.edit(if (path == null) "Clear take" else "Record scene") { StoryEditor.setSceneTake(it, id, path, ms) }
            }
            if (lines.isNotEmpty()) {
                Text("Or one take per line, for actors recorded separately. Once any line has a take, the lines are what plays.", style = body(12, Phosphor.dim))
                lines.forEachIndexed { i, l ->
                    val who = rows.characters.firstOrNull { it.id == l.characterId }?.name
                    TakeRow((if (who != null) "$who: " else "") + l.text, l.audioPath, l.audioDurationMs, "${n.slug}_line_${i + 1}") { path, ms ->
                        save(); Studio.edit(if (path == null) "Clear line take" else "Record line") { StoryEditor.setLineTake(it, l.id, path, ms) }
                    }
                }
            }

            if (n.nodeType != "ending") {
                Text("CHOICES", style = label())
                for (c in FlowLayout.doorsOf(rows, id)) {
                    Row(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.bg).clickable { save(); onChoice(c.id) }.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(c.digit, style = body(16, Phosphor.hi))
                        Column {
                            Text(c.label.ifBlank { "(no words yet)" }, style = body(14), maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text("→ " + sceneName(rows, c.toNodeId), style = body(12, if (c.toNodeId == null) Phosphor.alert else Phosphor.dim))
                        }
                    }
                }
                Chip("+ ADD CHOICE", false, enabled = StoryEditor.freeKey(rows, id) != null) {
                    save()
                    Studio.editWith("Add choice") { StoryEditor.addChoice(it, id, newScene = true) }?.let(onChoice)
                }
            }

            val into = rows.choices.filter { it.toNodeId == id } + rows.gates.filter { it.failNodeId == id }.mapNotNull { g -> rows.choices.firstOrNull { it.id == g.choiceId } }
            Text("REACHED FROM", style = label())
            if (into.isEmpty()) Text("Nothing leads here yet.", style = body(13, Phosphor.alert))
            for (c in into.distinctBy { it.id }) Text("${sceneName(rows, c.fromNodeId)} (${c.digit})", style = body(13, Phosphor.cyan), modifier = Modifier.clickable { save(); onGo(c.fromNodeId) })

            SheetButtons("▶ PLAY FROM HERE" to { save(); onPlay(id) }, "DONE" to { save(); onClose() })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (id != rows.story.rootNodeId) Chip("MAKE THIS THE START", false) { Studio.edit("Change start") { StoryEditor.setEntrance(it, id) } }
                if (id != rows.story.rootNodeId && !confirmDelete) Chip("DELETE SCENE", false) { confirmDelete = true }
            }
            if (confirmDelete) DeleteScene(rows, id, onCancel = { confirmDelete = false }) { joinTo ->
                Studio.edit("Delete scene") { StoryEditor.deleteScene(it, id, joinTo) }; onClose()
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChoiceSheet(rows: StoryRows, id: String, onClose: () -> Unit, onGo: (String) -> Unit, inSheet: Boolean = true) {
    val c = rows.choices.firstOrNull { it.id == id } ?: return onClose()
    var words by remember(id) { mutableStateOf(c.label) }
    var reply by remember(id) { mutableStateOf(c.reactionNarration ?: "") }
    val gate = rows.gates.firstOrNull { it.choiceId == id }
    var failLine by remember(id) { mutableStateOf(gate?.failNarration ?: "") }
    var picking by remember(id) { mutableStateOf<String?>(null) } // "to", "fork", "gives", "needs"
    var confirmDelete by remember(id) { mutableStateOf(false) }
    val taken = rows.choices.filter { it.fromNodeId == c.fromNodeId && it.id != id }.map { it.digit }.toSet()
    val need = StoryEditor.need(rows, id)
    val save = {
        if (words != c.label) Studio.edit("Rename choice") { StoryEditor.updateChoice(it, id, label = words) }
        if (reply != (c.reactionNarration ?: "")) Studio.edit("Edit reply") { StoryEditor.setReply(it, id, reply) }
        if (gate != null && gate.failBehavior == "refuse" && need != null && failLine != (gate.failNarration ?: ""))
            Studio.edit("Edit refusal") { StoryEditor.setNeed(it, id, need, "refuse", failLine = failLine) }
    }
    val latestSave by rememberUpdatedState(save)
    DisposableEffect(id) { onDispose { latestSave(); CarEdit.clearDrafts() } }

    SheetFrame(inSheet, onDismiss = { save(); onClose() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("CHOICE IN ${sceneName(rows, c.fromNodeId).uppercase()}", style = label())
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("KEY", style = label())
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (k in StoryEditor.KEYS) Box(Modifier.weight(1f)) { Chip(k, k == c.digit, enabled = k !in taken) { Studio.edit("Change key") { StoryEditor.updateChoice(it, id, digit = k) } } }
                }
            }
            Field("Choice name", words, { words = it; CarEdit.draft("label:$id", it) }, hint = "Give Moobert the helmet")
            Text("What this choice is called: on the flowchart, the keypad and the car screen.", style = body(12, Phosphor.dim))
            val forks = gate != null && gate.failBehavior == "divert" && need != null
            LinkRow(if (forks) "If they have it, leads to" else "Leads to", sceneName(rows, c.toNodeId), if (c.toNodeId == null) Phosphor.alert else Phosphor.fg) { save(); picking = "to" }
            Field("Reply · heard before the next scene", reply, { reply = it; CarEdit.draft("reply:$id", it) }, lines = 2, hint = "Carter: Careful. The stairs are wet.")
            val from = rows.nodes.firstOrNull { it.id == c.fromNodeId }?.slug ?: "CHOICE"
            if (reply.isNotBlank()) TakeRow("Reply take", c.audioPath, c.audioDurationMs, "${from}_reply_${c.digit}") { path, ms ->
                save(); Studio.edit(if (path == null) "Clear reply take" else "Record reply") { StoryEditor.setReplyTake(it, id, path, ms) }
            }

            LinkRow("Gives", StoryEditor.gives(rows, id)?.name ?: "nothing") { save(); picking = "gives" }
            if (gate != null && need == null) {
                // Written on the web app with counters or "lacks": shown, not edited here.
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("NEEDS", style = label())
                    Text(StoryEditor.describe(gate.expression) + if (gate.failBehavior == "divert") "  ·  otherwise → ${sceneName(rows, gate.failNodeId)}" else "  ·  otherwise refused", style = body(14, Phosphor.warn))
                    Text("Replace with items", style = body(13, Phosphor.cyan), modifier = Modifier.clickable { save(); picking = "needs" })
                }
            } else {
                LinkRow("Needs", need?.let { StoryEditor.needWords(rows, it) } ?: "nothing") { save(); picking = "needs" }
                if (gate != null && need != null) {
                    Text("IF THEY DON'T HAVE ${if (need.slugs.size > 1 && !need.any) "ALL OF THEM" else "IT"}", style = label())
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("Refuse · stay here", gate.failBehavior == "refuse") { save(); Studio.edit("Refuse") { StoryEditor.setNeed(it, id, need, "refuse", failLine = failLine) } }
                        Chip("Go to another scene", gate.failBehavior == "divert") { save(); picking = "fork" }
                    }
                    if (gate.failBehavior == "refuse") {
                        Field("What a refused caller hears", failLine, { failLine = it; CarEdit.draft("refuse:$id", it) }, lines = 2, hint = "You need something to haul on.")
                        TakeRow("Refusal take", gate.failAudioPath, null, "${from}_refused_${c.digit}") { path, _ ->
                            save(); Studio.edit(if (path == null) "Clear refusal take" else "Record refusal") { StoryEditor.setRefusalTake(it, id, path) }
                        }
                    } else {
                        LinkRow("If they don't, leads to", sceneName(rows, gate.failNodeId), if (gate.failNodeId == null) Phosphor.alert else Phosphor.fg) { picking = "fork" }
                        Text("Each scene plays its own script and offers its own choices. The reply above is heard either way.", style = body(12, Phosphor.dim))
                    }
                }
            }

            SheetButtons(
                *buildList {
                    c.toNodeId?.let { add("GO TO SCENE" to { save(); onGo(it) }) }
                    add("DONE" to { save(); onClose() })
                }.toTypedArray(),
            )
            Chip(if (confirmDelete) "TAP AGAIN TO DELETE" else "DELETE CHOICE", confirmDelete) {
                if (!confirmDelete) confirmDelete = true else { Studio.edit("Delete choice") { StoryEditor.deleteChoice(it, id) }; onClose() }
            }
        }
    }

    when (picking) {
        "to" -> ScenePicker(rows, "Pressing ${c.digit} leads to…", allowNew = true, onDismiss = { picking = null }) { pick ->
            when (pick) {
                null -> Studio.edit("Unwire choice") { StoryEditor.updateChoice(it, id, clearTo = true) }
                NEW -> Studio.editWith("Wire to new scene") { r ->
                    val (r2, scene) = StoryEditor.addScene(r, words, r.nodes.firstOrNull { it.id == c.fromNodeId }?.chapter)
                    StoryEditor.updateChoice(r2, id, to = scene) to scene
                }
                else -> Studio.edit("Wire choice") { StoryEditor.updateChoice(it, id, to = pick) }
            }
            picking = null
        }
        "fork" -> ScenePicker(rows, "If they don't have it, go to…", allowNew = true, onDismiss = { picking = null }) { pick ->
            val n = need ?: return@ScenePicker
            when (pick) {
                NEW -> Studio.edit("Fork to new scene") { r ->
                    val (r2, scene) = StoryEditor.addScene(r, "Without " + StoryEditor.needWords(r, n).lowercase(), r.nodes.firstOrNull { it.id == c.fromNodeId }?.chapter)
                    StoryEditor.setNeed(r2, id, n, "divert", failNode = scene)
                }
                else -> Studio.edit("Fork") { StoryEditor.setNeed(it, id, n, "divert", failNode = pick) }
            }
            picking = null
        }
        "gives" -> ItemPicker(rows, "Pressing ${c.digit} gives…", onDismiss = { picking = null }) { varId ->
            Studio.edit("Give item") { StoryEditor.setGives(it, id, varId) }; picking = null
        }
        "needs" -> NeedPicker(rows, id, "Pressing ${c.digit} needs…") { picking = null }
    }
}

const val NEW = "\u0000new"

/**
 * Deleting a scene in the middle of a path joins the scenes either side: the
 * choices that led into it lead on to where it went. One way on joins up by
 * itself; with several, pick which (or leave them leading nowhere yet).
 */
@Composable
private fun DeleteScene(rows: StoryRows, id: String, onCancel: () -> Unit, onDelete: (String?) -> Unit) {
    val into = StoryEditor.into(rows, id)
    val on = StoryEditor.onward(rows, id)
    val n = into.size
    val choices = if (n == 1) "The choice into it" else "The $n choices into it"
    Column(Modifier.fillMaxWidth().border(1.dp, Phosphor.alert).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("DELETE “${sceneName(rows, id).uppercase()}”?", style = body(15, Phosphor.alert))
        when {
            n == 0 -> Text("Nothing leads into it.", style = body(13, Phosphor.dim))
            on.isEmpty() -> Text("$choices will lead nowhere yet: it has no way on to join them to.", style = body(13, Phosphor.dim))
            on.size == 1 -> Text("$choices will lead to ${sceneName(rows, on[0])} instead.", style = body(13, Phosphor.fg))
            else -> Text("It leads on to ${on.size} scenes. Where should ${choices.replaceFirstChar { it.lowercase() }} go?", style = body(13, Phosphor.fg))
        }
        if (n > 0 && on.size > 1) {
            for (t in on) Chip("JOIN TO ${sceneName(rows, t).uppercase()}", false) { onDelete(t) }
            Chip("LEAVE THEM UNJOINED", false) { onDelete(null) }
            Chip("CANCEL", false, onClick = onCancel)
        } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(if (n > 0 && on.size == 1) "DELETE AND JOIN UP" else "DELETE", true) { onDelete(on.singleOrNull()?.takeIf { n > 0 }) }
            Chip("CANCEL", false, onClick = onCancel)
        }
    }
}

/**
 * Which chapter a scene is in. Chapters lay out as separate lanes on the
 * flowchart, so this is how two storylines are kept apart. "Its whole branch"
 * also moves every scene that can ONLY be reached through this one — on
 * William, Mike's intro takes Mike's 42 scenes with it, and nothing of Carter's.
 */
@Composable
private fun ChapterPicker(rows: StoryRows, id: String, beforeEdit: () -> Unit) {
    val n = rows.nodes.firstOrNull { it.id == id } ?: return
    val branch = remember(rows, id) { StoryEditor.branchOf(rows, id) }
    var wholeBranch by remember(id) { mutableStateOf(branch.size > 1) }
    var naming by remember(id) { mutableStateOf(false) }
    val apply = { ch: String? ->
        beforeEdit()
        val ids = if (wholeBranch) branch else setOf(id)
        Studio.edit(if (ch == null) "Remove from chapter" else "Move to $ch") { StoryEditor.setChapter(it, ids, ch) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("CHAPTER · ITS OWN LANE ON THE FLOWCHART", style = label())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Chip("None", n.chapter.isNullOrBlank()) { apply(null) }
            for (ch in StoryEditor.chapters(rows)) Chip(ch, n.chapter == ch) { apply(ch) }
            Chip("+ New…", false) { naming = true }
        }
        if (branch.size > 1) Row(Modifier.clickable { wholeBranch = !wholeBranch }, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (wholeBranch) "▣" else "□", style = body(15, Phosphor.fg))
            Text("Its whole branch: this scene and the ${branch.size - 1} only reachable through it", style = body(13, Phosphor.fg))
        }
    }
    if (naming) AskText("Name the chapter", "Create") { t -> naming = false; if (!t.isNullOrBlank()) apply(t) }
}

@Composable
fun ScenePicker(rows: StoryRows, title: String, allowNew: Boolean, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    var query by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = body(17, Phosphor.hi))
            Field("Find", query, { query = it }, hint = "Search scenes")
            val found = rows.nodes.filter { query.isBlank() || "${it.title} ${it.slug} ${it.narration}".contains(query, ignoreCase = true) }
                .sortedBy { it.title.ifBlank { it.slug }.lowercase() }
            LazyColumn(Modifier.heightIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (allowNew) item { PickRow("+ A NEW SCENE", Phosphor.cyan) { onPick(NEW) } }
                item { PickRow("Nowhere yet", Phosphor.alert) { onPick(null) } }
                items(found, key = { it.id }) { n -> PickRow(n.title.ifBlank { n.slug }, Phosphor.fg) { onPick(n.id) } }
            }
        }
    }
}

/**
 * What a choice needs: tick one item or several, and with several, whether
 * ANY ONE of them will do or the caller needs ALL of them. Each tick is saved
 * as it's made, so the sheet behind is always up to date.
 */
@Composable
fun NeedPicker(rows: StoryRows, choiceId: String, title: String, onDone: () -> Unit) {
    val need = StoryEditor.need(rows, choiceId)
    val complex = need == null && rows.gates.any { it.choiceId == choiceId }
    var newName by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onDone) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = body(17, Phosphor.hi))
            if (complex) Text("Ticking an item replaces the condition written on the web app.", style = body(12, Phosphor.warn))
            val items = rows.stateVars.filter { it.kind != "counter" }
            LazyColumn(Modifier.heightIn(max = 300.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(items, key = { it.id }) { v ->
                    val on = need?.slugs?.contains(v.slug) == true
                    Row(Modifier.fillMaxWidth().border(1.dp, if (on) Phosphor.fg else Phosphor.line).background(Phosphor.panel)
                        .clickable { Studio.edit(if (on) "Don't need ${v.name}" else "Need ${v.name}") { r ->
                            if (complex) StoryEditor.setNeed(r, choiceId, StoryEditor.Need(listOf(v.slug))) else StoryEditor.toggleNeed(r, choiceId, v.slug)
                        } }.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(if (on) "▣" else "□", style = body(16, if (on) Phosphor.hi else Phosphor.fg))
                        Text(v.name.ifBlank { v.slug }, style = body(15, if (on) Phosphor.hi else Phosphor.fg))
                    }
                }
            }
            if (need != null && need.slugs.size > 1) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Chip("Any one of these", need.any) { Studio.edit("Needs any one") { StoryEditor.setNeedAny(it, choiceId, true) } }
                Chip("All of these", !need.any) { Studio.edit("Needs all") { StoryEditor.setNeedAny(it, choiceId, false) } }
            }
            if (need != null) Text("Needs " + StoryEditor.needWords(rows, need) + ".", style = body(13, Phosphor.cyan))
            Field("Or a new item", newName, { newName = it }, hint = "A coil of rope")
            if (newName.isNotBlank()) PickRow("+ ADD \"${newName.trim()}\"", Phosphor.cyan) {
                val name = newName.trim()
                Studio.edit("New item") { r -> val (r2, v) = StoryEditor.addItem(r, name); if (complex) StoryEditor.setNeed(r2, choiceId, StoryEditor.Need(listOf(v.slug))) else StoryEditor.toggleNeed(r2, choiceId, v.slug) }
                newName = ""
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (need != null || complex) Box(Modifier.weight(1f)) { Chip("NEEDS NOTHING", false) { Studio.edit("Need nothing") { StoryEditor.setNeed(it, choiceId, null) }; onDone() } }
                Box(Modifier.weight(1f)) { Chip("DONE", true, onClick = onDone) }
            }
        }
    }
}

@Composable
fun ItemPicker(rows: StoryRows, title: String, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    var newName by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = body(17, Phosphor.hi))
            LazyColumn(Modifier.heightIn(max = 300.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                item { PickRow("Nothing", Phosphor.dim) { onPick(null) } }
                items(rows.stateVars, key = { it.id }) { v -> PickRow(v.name.ifBlank { v.slug }, Phosphor.fg) { onPick(v.id) } }
            }
            Field("Or a new item", newName, { newName = it }, hint = "A coil of rope")
            if (newName.isNotBlank()) PickRow("+ ADD \"${newName.trim()}\"", Phosphor.cyan) {
                Studio.editWith("New item") { StoryEditor.addItem(it, newName.trim()) }?.let { v -> onPick(v.id) }
            }
        }
    }
}

@Composable
private fun PickRow(text: String, color: Color, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.panel).clickable(onClick = onClick).padding(12.dp)) {
        Text(text, style = body(15, color), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
