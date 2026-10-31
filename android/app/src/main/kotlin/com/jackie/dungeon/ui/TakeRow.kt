package com.jackie.dungeon.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.jackie.dungeon.Studio
import com.jackie.dungeon.Takes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * One recordable slot: a scene, a speaker line, a reply, a refusal.
 *
 * Tap ● REC to start and ■ STOP to finish (tap, not hold: a scroll that starts
 * on a hold button is how the web app learned to guard against accidental
 * takes). FILE… brings in a finished recording. Either way the take is
 * converted to 8 kHz before it is attached, and the old one is kept on disk
 * so UNDO can put it back.
 */
@Composable
fun TakeRow(label: String, path: String?, ms: Int?, fileName: String, onSet: (String?, Int?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var recording by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var level by remember { mutableFloatStateOf(0f) }
    val storyId = Studio.rows.value?.story?.id ?: "story"

    LaunchedEffect(recording) { while (recording) { level = Takes.level; delay(60) } }

    fun begin() {
        note = null
        if (Takes.start()) recording = true else note = "The microphone couldn't be opened."
    }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) begin() else note = "Jackie Dungeon needs the microphone to record."
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        busy = true; note = "Converting…"
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { val f = Takes.file(context, storyId, fileName); f.path to Takes.import(context, uri, f) }
            }
            busy = false
            result.onSuccess { (p, d) -> note = null; onSet(p, d) }.onFailure { note = it.message ?: "That file couldn't be read." }
        }
    }

    Column(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).background(Phosphor.bg).padding(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = mono(13, Phosphor.dim), maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (recording) Box(Modifier.fillMaxWidth(level.coerceIn(0.02f, 1f)).height(6.dp).background(Phosphor.fg))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Small(if (recording) "■ STOP" else "● REC", if (recording) Phosphor.alert else Phosphor.fg, enabled = !busy) {
                if (recording) {
                    recording = false; busy = true; note = "Saving…"
                    scope.launch {
                        val f = Takes.file(context, storyId, fileName)
                        val d = withContext(Dispatchers.Default) { Takes.stop(f) }
                        busy = false
                        if (d == null) note = "Too short to keep (under half a second)." else { note = null; onSet(f.path, d) }
                    }
                } else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin()
                else ask.launch(Manifest.permission.RECORD_AUDIO)
            }
            if (path != null && !recording) Small(if (playing) "■" else "▶", Phosphor.fg, enabled = !busy) {
                if (playing) { Takes.stopPreview(); playing = false }
                else if (File(path).exists()) { playing = true; Takes.play(path) { playing = false } }
                else note = "That take is a link, not a file on this phone."
            }
            if (!recording) Small("FILE…", Phosphor.fg, enabled = !busy) { pick.launch(arrayOf("audio/*")) }
            if (path != null && !recording) Small("✕", Phosphor.dim, enabled = !busy) { Takes.stopPreview(); playing = false; onSet(null, null) }
            Text(
                when { recording -> "● RECORDING"; path != null -> "▣ " + seconds(ms); else -> "□ silent" },
                style = mono(12, when { recording -> Phosphor.alert; path != null -> Phosphor.fg; else -> Phosphor.warn }),
                textAlign = TextAlign.End, modifier = Modifier.weight(1f),
            )
        }
        note?.let { Text(it, style = mono(12, Phosphor.warn)) }
    }
}

private fun seconds(ms: Int?) = if (ms == null) "recorded" else "%.1fs".format(ms / 1000f)

private fun mono(size: Int, color: Color) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

@Composable
private fun Small(text: String, color: Color, enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.border(1.dp, if (enabled) color else Phosphor.line).background(Phosphor.panel).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text(text, style = mono(14, if (enabled) color else Phosphor.line))
    }
}
