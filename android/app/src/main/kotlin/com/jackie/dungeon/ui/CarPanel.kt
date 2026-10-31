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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jackie.dungeon.CarEdit
import com.jackie.dungeon.Studio
import com.jackie.dungeon.car.Action
import com.jackie.dungeon.car.Highlight
import com.jackie.dungeon.car.Mode
import com.jackie.dungeon.car.Popup

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

private val HIGHLIGHT_COLOR = mapOf(Highlight.EMPTY to Phosphor.warn, Highlight.DEAD_END to Phosphor.alert, Highlight.UNRECORDED to Phosphor.cyan)

/**
 * The car screen's switches, on the phone: PLAY or EDIT, and — in EDIT — what
 * the car's map should light up. Highlights live here rather than on the car
 * because they're set once and looked at for a while.
 */
@Composable
fun CarControls(modifier: Modifier = Modifier) {
    val s by CarEdit.state.collectAsStateWithLifecycle()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("CAR SCREEN", style = style(18, Phosphor.dim))
            for (m in Mode.entries) {
                val on = s.mode == m
                Box(
                    Modifier.weight(1f).border(1.dp, if (on) Phosphor.fg else Phosphor.line).background(if (on) Phosphor.fg else Phosphor.panel)
                        .clickable { CarEdit.setMode(m) }.semantics { contentDescription = "Car screen ${m.name.lowercase()}" }.padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(m.name, style = style(20, if (on) Phosphor.bg else Phosphor.fg)) }
            }
        }
        if (s.mode == Mode.EDIT) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("LIGHT UP", style = mono(11, Phosphor.dim))
            for (h in Highlight.entries) {
                val on = h in s.highlights
                Row(Modifier.clickable { CarEdit.toggle(h) }.semantics { contentDescription = "Highlight ${h.label.lowercase()}" }.padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (on) "▣" else "□", style = mono(16, HIGHLIGHT_COLOR.getValue(h)))
                    Text(h.label, style = mono(12, if (on) HIGHLIGHT_COLOR.getValue(h) else Phosphor.fg))
                }
            }
        }
    }
}

/**
 * "Play from here" with items, on the phone as well as the car: the same
 * list, the same state, either screen can tick things and press START.
 */
@Composable
fun PlayHereDialog() {
    val s by CarEdit.state.collectAsStateWithLifecycle()
    val rows by Studio.rows.collectAsStateWithLifecycle()
    val p = s.popup as? Popup.PlayHere ?: return
    val r = rows ?: return
    Dialog(onDismissRequest = { CarEdit.dispatch(Action.Dismiss) }) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("PLAY FROM ${sceneName(r, p.nodeId).uppercase()}", style = style(22, Phosphor.hi))
            Text(if (r.stateVars.isEmpty()) "This story has no items." else "Carrying:", style = mono(13, Phosphor.dim))
            LazyColumn(Modifier.heightIn(max = 320.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(r.stateVars, key = { it.id }) { v ->
                    val n = p.carrying[v.slug] ?: 0
                    val name = v.name.ifBlank { v.slug }
                    if (v.kind == "counter") Row(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, style = mono(15), modifier = Modifier.weight(1f))
                        Text(" − ", style = mono(18), modifier = Modifier.clickable { CarEdit.dispatch(Action.Carry(v.slug, n - 1)) }.padding(horizontal = 8.dp))
                        Text("$n", style = mono(16, Phosphor.hi))
                        Text(" + ", style = mono(18), modifier = Modifier.clickable { CarEdit.dispatch(Action.Carry(v.slug, n + 1)) }.padding(horizontal = 8.dp))
                    } else Row(Modifier.fillMaxWidth().border(1.dp, if (n > 0) Phosphor.fg else Phosphor.line).clickable { CarEdit.dispatch(Action.Carry(v.slug, if (n > 0) 0 else 1)) }.padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(if (n > 0) "▣" else "□", style = mono(16, if (n > 0) Phosphor.hi else Phosphor.fg))
                        Text(name, style = mono(15, if (n > 0) Phosphor.hi else Phosphor.fg))
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { CarEdit.dispatch(Action.Dismiss) }
                Button("START", Modifier.weight(1f), primary = true) { CarEdit.dispatch(Action.StartCall) }
            }
        }
    }
}
