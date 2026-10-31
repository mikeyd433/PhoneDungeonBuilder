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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
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
    SheetFrame(inSheet, onDismiss = { save(); onClose() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(if (id == rows.story.rootNodeId) "START SCENE" else "SCENE", style = label())
            Field("Name", title, { title = it }, hint = "Name this scene")
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("ENDS THE CALL?", style = label())
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((k, t) in listOf("room" to "No", "death" to "Death", "win" to "Win")) Chip(t, kind == k) { Studio.edit("Change ending") { StoryEditor.updateScene(it, id, kind = k) } }
                }
            }
            Field("Script · \"Name: line\" for a speaker", script, { script = it }, lines = 5, hint = "What the caller hears in this scene")
            val split = rows.dialogueLines.count { it.nodeId == id }
            if (split > 0) Text("Split into $split speaker lines. They follow the script when you edit it.", style = body(12, Phosphor.dim))
            else if (script.contains(':')) Text("Split by speaker", style = body(13, Phosphor.cyan), modifier = Modifier.clickable { save(); Studio.edit("Split by speaker") { StoryEditor.splitIntoLines(it, nodeId = id) } })

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
                if (id != rows.story.rootNodeId) Chip(if (confirmDelete) "TAP AGAIN TO DELETE" else "DELETE SCENE", confirmDelete) {
                    if (!confirmDelete) confirmDelete = true else { Studio.edit("Delete scene") { StoryEditor.deleteScene(it, id) }; onClose() }
                }
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
    val simple = StoryEditor.simpleRequirement(rows, id)
    val save = {
        if (words != c.label) Studio.edit("Edit choice words") { StoryEditor.updateChoice(it, id, label = words) }
        if (reply != (c.reactionNarration ?: "")) Studio.edit("Edit reply") { StoryEditor.setReply(it, id, reply) }
        if (gate != null && gate.failBehavior == "refuse" && simple != null && failLine != (gate.failNarration ?: ""))
            Studio.edit("Edit refusal") { StoryEditor.setRequires(it, id, simple, "refuse", failLine = failLine) }
    }

    SheetFrame(inSheet, onDismiss = { save(); onClose() }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("CHOICE IN ${sceneName(rows, c.fromNodeId).uppercase()}", style = label())
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("KEY", style = label())
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (k in StoryEditor.KEYS) Box(Modifier.weight(1f)) { Chip(k, k == c.digit, enabled = k !in taken) { Studio.edit("Change key") { StoryEditor.updateChoice(it, id, digit = k) } } }
                }
            }
            Field("What the caller hears", words, { words = it }, hint = "go below")
            LinkRow("Leads to", sceneName(rows, c.toNodeId), if (c.toNodeId == null) Phosphor.alert else Phosphor.fg) { save(); picking = "to" }
            Field("Reply · heard before the next scene", reply, { reply = it }, lines = 2, hint = "Carter: Careful. The stairs are wet.")

            LinkRow("Gives", StoryEditor.gives(rows, id)?.name ?: "nothing") { save(); picking = "gives" }
            if (gate != null && simple == null) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("REQUIRES", style = label())
                    Text(StoryEditor.describe(gate.expression) + if (gate.failBehavior == "divert") "  ·  otherwise → ${sceneName(rows, gate.failNodeId)}" else "  ·  otherwise refused", style = body(14, Phosphor.warn))
                    Text("Replace with a simple condition", style = body(13, Phosphor.cyan), modifier = Modifier.clickable { save(); picking = "needs" })
                }
            } else {
                LinkRow("Requires", simple?.let { s -> rows.stateVars.firstOrNull { it.slug == s }?.name ?: s } ?: "nothing") { save(); picking = "needs" }
                if (gate != null && simple != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Chip("If not: refuse", gate.failBehavior == "refuse") { Studio.edit("Refuse") { StoryEditor.setRequires(it, id, simple, "refuse", failLine = failLine) } }
                        Chip("If not: go elsewhere", gate.failBehavior == "divert") { save(); picking = "fork" }
                    }
                    if (gate.failBehavior == "refuse") Field("What a refused caller hears", failLine, { failLine = it }, lines = 2, hint = "You need something to haul on.")
                    else LinkRow("Without it, go to", sceneName(rows, gate.failNodeId), if (gate.failNodeId == null) Phosphor.alert else Phosphor.fg) { picking = "fork" }
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
        "fork" -> ScenePicker(rows, "Without it, go to…", allowNew = true, onDismiss = { picking = null }) { pick ->
            val item = simple ?: return@ScenePicker
            when (pick) {
                NEW -> Studio.edit("Fork to new scene") { r ->
                    val (r2, scene) = StoryEditor.addScene(r, "Without the ${item.lowercase()}")
                    StoryEditor.setRequires(r2, id, item, "divert", failNode = scene)
                }
                else -> Studio.edit("Fork") { StoryEditor.setRequires(it, id, item, "divert", failNode = pick) }
            }
            picking = null
        }
        "gives" -> ItemPicker(rows, "Pressing ${c.digit} gives…", onDismiss = { picking = null }) { varId ->
            Studio.edit("Give item") { StoryEditor.setGives(it, id, varId) }; picking = null
        }
        "needs" -> ItemPicker(rows, "Pressing ${c.digit} requires…", onDismiss = { picking = null }) { varId ->
            val slug = rows.stateVars.firstOrNull { it.id == varId }?.slug
                ?: varId?.let { v -> Studio.rows.value?.stateVars?.firstOrNull { it.id == v }?.slug }
            Studio.edit("Require item") { StoryEditor.setRequires(it, id, slug, gate?.failBehavior?.takeIf { slug != null } ?: "refuse", failLine = failLine, failNode = gate?.failNodeId) }
            picking = null
        }
    }
}

const val NEW = "\u0000new"

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
