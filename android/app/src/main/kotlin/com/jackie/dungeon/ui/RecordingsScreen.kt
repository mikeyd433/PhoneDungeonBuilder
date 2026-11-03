package com.jackie.dungeon.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.jackie.dungeon.Studio
import com.jackie.dungeon.story.Recordings
import com.jackie.dungeon.story.StoryRows

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

/**
 * RECORDINGS: everything the story needs a take of, in the order a caller
 * hears it — each scene's script (or its lines, once it plays line by line)
 * and each choice's reply. Takes are mostly recorded elsewhere: tap FILE… on
 * one to attach its finished file (or ● REC to record it here).
 */
@Composable
fun RecordingsDialog(rows: StoryRows, onGo: (String) -> Unit, onDone: () -> Unit) {
    var missingOnly by remember { mutableStateOf(true) }
    val all = remember(rows) { Recordings.slots(rows) }
    val done = all.count { it.recorded }
    // A slot stays on the "missing" list until the list is reopened, so attaching
    // a file doesn't make the row jump away under your finger.
    val shownIds = remember(missingOnly) { all.filter { !missingOnly || !it.recorded }.map { key(it) }.toSet() }
    val shown = all.filter { key(it) in shownIds }
    Dialog(onDismissRequest = onDone, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(Phosphor.bg).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("RECORDINGS", style = style(24, Phosphor.hi), modifier = Modifier.weight(1f))
                Text("DONE", style = style(20, Phosphor.fg), modifier = Modifier.border(1.dp, Phosphor.line).clickable { onDone() }.padding(horizontal = 12.dp, vertical = 4.dp))
            }
            Text("$done of ${all.size} recorded · in the order a caller hears them", style = mono(13, if (done == all.size) Phosphor.cyan else Phosphor.dim))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((v, label) in listOf(true to "STILL MISSING (${all.size - done})", false to "ALL (${all.size})")) {
                    val on = missingOnly == v
                    Text(label, style = mono(13, if (on) Phosphor.bg else Phosphor.fg), modifier = Modifier.border(1.dp, if (on) Phosphor.fg else Phosphor.line)
                        .background(if (on) Phosphor.fg else Phosphor.panel).clickable { missingOnly = v }.padding(horizontal = 10.dp, vertical = 6.dp))
                }
            }
            if (shown.isEmpty()) Text(if (all.isEmpty()) "Nothing to record yet: no scene has a script." else "Everything is recorded.", style = mono(14, Phosphor.cyan))
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(shown, key = { key(it) }) { slot ->
                    // The current state of this slot (it may have just been filled).
                    val now = all.firstOrNull { key(it) == key(slot) } ?: slot
                    Column(Modifier.fillMaxWidth().border(1.dp, if (now.recorded) Phosphor.line else Phosphor.warn.copy(alpha = 0.6f)).background(Phosphor.panel).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(now.scene, style = mono(14, Phosphor.hi), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).clickable { onGo(now.sceneId) })
                            Text(if (now.recorded) "♪ recorded" else "missing", style = mono(12, if (now.recorded) Phosphor.cyan else Phosphor.warn))
                        }
                        Text(now.what, style = mono(12, Phosphor.dim))
                        Text(now.text, style = mono(13, Phosphor.fg), maxLines = 4, overflow = TextOverflow.Ellipsis)
                        Box(Modifier.fillMaxWidth()) {
                            TakeRow("Take · file \"${now.fileName}\"", now.path, now.ms, now.fileName) { path, ms ->
                                Studio.edit(if (path == null) "Clear take" else "Add take") { Recordings.set(it, now, path, ms) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun key(s: Recordings.Slot) = "${s.kind}:${s.sceneId}:${s.choiceId}:${s.lineId}"
