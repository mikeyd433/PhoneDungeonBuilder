package com.jackie.dungeon.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.runtime.setValue
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
fun CarControls(modifier: Modifier = Modifier, showMode: Boolean = true, compact: Boolean = false) {
    val mode by CarEdit.mode.collectAsStateWithLifecycle()
    val lit by CarEdit.highlights.collectAsStateWithLifecycle()
    // Above the phone's flowchart with a car attached: one short scrolling row, so the map keeps the room.
    if (compact) {
        Row(modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (mode == Mode.EDIT) {
                Text("LIGHT UP", style = mono(10, Phosphor.dim))
                for (h in Highlight.entries) {
                    val on = h in lit
                    Row(Modifier.clickable { CarEdit.toggle(h) }.semantics { contentDescription = "Highlight ${h.label.lowercase()}" }.padding(vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (on) "▣" else "□", style = mono(13, HIGHLIGHT_COLOR.getValue(h)))
                        Text(h.label, style = mono(10, if (on) HIGHLIGHT_COLOR.getValue(h) else Phosphor.fg))
                    }
                }
            }
            CarSettingsLink(compact = true)
        }
        return
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (showMode) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("CAR SCREEN", style = style(18, Phosphor.dim))
            for (m in Mode.entries) {
                val on = mode == m
                Box(
                    Modifier.weight(1f).border(1.dp, if (on) Phosphor.fg else Phosphor.line).background(if (on) Phosphor.fg else Phosphor.panel)
                        .clickable { CarEdit.setMode(m) }.semantics { contentDescription = "Car screen ${m.name.lowercase()}" }.padding(vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(m.name, style = style(20, if (on) Phosphor.bg else Phosphor.fg)) }
            }
        }
        if (mode == Mode.EDIT) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("LIGHT UP", style = mono(11, Phosphor.dim))
            for (h in Highlight.entries) {
                val on = h in lit
                Row(Modifier.clickable { CarEdit.toggle(h) }.semantics { contentDescription = "Highlight ${h.label.lowercase()}" }.padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (on) "▣" else "□", style = mono(16, HIGHLIGHT_COLOR.getValue(h)))
                    Text(h.label, style = mono(12, if (on) HIGHLIGHT_COLOR.getValue(h) else Phosphor.fg))
                }
            }
        }
        CarSettingsLink()
    }
}

/**
 * "Play from here" with items, on the phone as well as the car: the same
 * list, the same state, either screen can tick things and press START.
 */
@Composable
fun PlayHereDialog() {
    val popup by CarEdit.popup.collectAsStateWithLifecycle()
    val rows by Studio.rows.collectAsStateWithLifecycle()
    val p = popup as? Popup.PlayHere ?: return
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

/**
 * CAR SCREEN SETTINGS: every slider moves the car screen live, so it can be
 * tuned while looking at the car. Saved on this phone.
 */
@Composable
fun CarSettingsDialog(onDone: () -> Unit) {
    val s by com.jackie.dungeon.CarScreen.settings.collectAsStateWithLifecycle()
    Dialog(onDismissRequest = onDone) {
        Column(
            Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp)
                .heightIn(max = 640.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("CAR SCREEN SETTINGS", style = style(22, Phosphor.hi))
            Text("Changes show on the car as you slide.", style = mono(12, Phosphor.dim))
            CarTextSize(Modifier.fillMaxWidth())
            Text("PHOSPHOR", style = mono(11, Phosphor.dim))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (c in com.jackie.dungeon.CarScreen.Colour.entries) {
                    val on = s.colour == c
                    Box(Modifier.weight(1f).border(1.dp, if (on) Phosphor.fg else Phosphor.line).background(if (on) Phosphor.fg else Phosphor.panel)
                        .clickable { com.jackie.dungeon.CarScreen.update { it.copy(colour = c) } }.padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
                        Text(c.label.uppercase(), style = style(18, if (on) Phosphor.bg else Phosphor.fg))
                    }
                }
            }
            Text("Amber and white show everything in one colour, as those tubes did.", style = mono(11, Phosphor.dim))
            Setting("Typing speed", s.typing, 10f..120f, "${s.typing.toInt()} letters/s") { v -> com.jackie.dungeon.CarScreen.update { it.copy(typing = v) } }
            Text("MAP FOLLOWING THE PHONE", style = mono(11, Phosphor.dim))
            Setting("How much wider than the phone", s.mirrorMargin, 1f..2.5f, "×%.2f".format(s.mirrorMargin)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(mirrorMargin = v) } }
            Setting("Shift up / down", s.mirrorLift, -0.3f..0.3f, if (s.mirrorLift >= 0) "up %.0f%%".format(s.mirrorLift * 100) else "down %.0f%%".format(-s.mirrorLift * 100)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(mirrorLift = v) } }
            Text("THE GLASS", style = mono(11, Phosphor.dim))
            Setting("Curve", s.curve, 0f..2f, if (s.curve < 0.05f) "flat" else "%.1f".format(s.curve)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(curve = v) } }
            Setting("Scanlines", s.scanlines, 0f..1f, "%.0f%%".format(s.scanlines * 100)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(scanlines = v) } }
            Setting("Glow", s.glow, 0f..2f, "%.1f".format(s.glow)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(glow = v) } }
            Setting("Rolling band brightness", s.barBright, 0f..3f, if (s.barBright < 0.05f) "off" else "%.1f".format(s.barBright)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(barBright = v) } }
            Setting("Rolling band speed", s.barSpeed, 0f..3f, if (s.barSpeed < 0.05f) "still" else "%.1f".format(s.barSpeed)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(barSpeed = v) } }
            Setting("Flicker", s.flicker, 0f..2f, if (s.flicker < 0.05f) "steady" else "%.1f".format(s.flicker)) { v -> com.jackie.dungeon.CarScreen.update { it.copy(flicker = v) } }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("RESET ALL", Modifier.weight(1f)) { com.jackie.dungeon.CarScreen.reset() }
                Button("DONE", Modifier.weight(1f), primary = true) { onDone() }
            }
        }
    }
}

@Composable
private fun Setting(name: String, value: Float, range: ClosedFloatingPointRange<Float>, shown: String, onChange: (Float) -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(name, style = mono(13, Phosphor.fg))
            Text(shown, style = mono(13, Phosphor.cyan))
        }
        androidx.compose.material3.Slider(
            value = value.coerceIn(range), onValueChange = onChange, valueRange = range,
            colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = Phosphor.hi, activeTrackColor = Phosphor.fg, inactiveTrackColor = Phosphor.line),
        )
    }
}

/** The way into CAR SCREEN SETTINGS. */
@Composable
fun CarSettingsLink(modifier: Modifier = Modifier, compact: Boolean = false) {
    var open by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    if (compact) Text("⚙ CAR SCREEN", style = mono(10, Phosphor.cyan), modifier = modifier.border(1.dp, Phosphor.line).clickable { open = true }.padding(horizontal = 6.dp, vertical = 3.dp))
    else Text("⚙ CAR SCREEN SETTINGS", style = mono(13, Phosphor.cyan), modifier = modifier.border(1.dp, Phosphor.line).clickable { open = true }.padding(horizontal = 10.dp, vertical = 6.dp))
    if (open) CarSettingsDialog { open = false }
}
