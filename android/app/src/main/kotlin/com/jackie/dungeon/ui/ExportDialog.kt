package com.jackie.dungeon.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.jackie.dungeon.Exporter
import com.jackie.dungeon.story.StoryRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

/**
 * EXPORT FOR TWILIO: one zip with the flow to import, the takes to upload, and
 * a README that says how — and what will be silent. Nothing is sent to Twilio.
 */
@Composable
fun ExportDialog(rows: StoryRows, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var base by remember { mutableStateOf(Exporter.audioBase(context)) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<Exporter.Done?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val hasTakes = remember(rows) {
        (rows.nodes.map { it.audioPath } + rows.choices.map { it.audioPath } + rows.gates.map { it.failAudioPath } +
            rows.dialogueLines.map { it.audioPath }).any { it?.startsWith("/") == true }
    }

    Dialog(onDismissRequest = { if (!busy) onClose() }) {
        Column(
            Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp).heightIn(max = 640.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("EXPORT FOR TWILIO", style = style(26, Phosphor.hi))
            Text("A zip with flow.json to import into Studio, your recordings as 8 kHz WAVs to upload, and a README with the steps.", style = mono(13, Phosphor.dim))
            Text("WHERE THE AUDIO WILL LIVE", style = mono(11, Phosphor.dim))
            Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).padding(10.dp)) {
                if (base.isEmpty()) Text("https://your-service-1234.twil.io", style = mono(14, Phosphor.line))
                BasicTextField(base, { base = it; done = null }, textStyle = mono(14), cursorBrush = SolidColor(Phosphor.fg), singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            Text("The public address you'll upload the audio/ folder to — a Twilio Assets service is easiest. Each Play widget points at <address>/<file>.", style = mono(12, Phosphor.dim))
            if (hasTakes && base.isBlank()) Text("This story has recordings, so it needs an address.", style = mono(12, Phosphor.warn))

            val d = done
            if (d == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button("CANCEL", Modifier.weight(1f)) { if (!busy) onClose() }
                    Button(if (busy) "EXPORTING…" else "EXPORT", Modifier.weight(1f), primary = true) {
                        if (busy || (hasTakes && base.isBlank())) return@Button
                        busy = true; error = null
                        Exporter.setAudioBase(context, base)
                        scope.launch {
                            val r = withContext(Dispatchers.Default) { runCatching { Exporter.export(context, rows, base) } }
                            busy = false
                            r.onSuccess { done = it }.onFailure { error = it.message ?: "The export failed." }
                        }
                    }
                }
            } else {
                Text("${d.zip.name}", style = mono(14, Phosphor.hi))
                Text("${d.result.widgets} of ${d.result.limit} Studio widgets · ${d.files} recording${if (d.files == 1) "" else "s"} to upload", style = mono(13))
                if (d.result.warnings.isEmpty()) Text("Nothing will be silent on the phone.", style = mono(13))
                else {
                    Text("${d.result.warnings.size} thing${if (d.result.warnings.size == 1) "" else "s"} will be silent or broken on the phone:", style = mono(13, Phosphor.warn))
                    d.result.warnings.take(6).forEach { Text("· $it", style = mono(12, Phosphor.warn)) }
                    if (d.result.warnings.size > 6) Text("…and ${d.result.warnings.size - 6} more, listed in README.txt", style = mono(12, Phosphor.dim))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button("DONE", Modifier.weight(1f)) { onClose() }
                    Button("SHARE ZIP", Modifier.weight(1f), primary = true) { Exporter.share(context, d.zip) }
                }
            }
            error?.let { Text(it, style = mono(13, Phosphor.alert)) }
        }
    }
}
