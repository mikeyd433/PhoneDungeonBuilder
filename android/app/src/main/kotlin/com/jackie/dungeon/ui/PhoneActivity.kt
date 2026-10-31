package com.jackie.dungeon.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jackie.dungeon.AppGraph
import com.jackie.dungeon.R
import com.jackie.dungeon.call.CallSession.Phase

/**
 * The phone: the keypad, and the one place with menus.
 *
 * While the car screen shows the story, this is a controller — the keys that
 * do something right now are lit, labelled with what they do. With no car
 * screen, it says so and offers the preview, which is how this is tested
 * without a car.
 */
class PhoneActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { AppScreen() }
    }

    override fun onStart() { super.onStart(); AppGraph.activityStarted() }
    override fun onStop() { AppGraph.activityStopped(); super.onStop() }
}

object Phosphor {
    val bg = Color(0xFF050B06)
    val panel = Color(0xFF0A130B)
    val fg = Color(0xFF8DFC9A)
    val hi = Color(0xFFDCFFE0)
    val dim = Color(0xFF4C8A55)
    val line = Color(0xFF1D4424)
    val warn = Color(0xFFE8D24A)
    val alert = Color(0xFFFF6B4A)
    val raise = Color(0xFF0F1C11)
    val cyan = Color(0xFF62E3D3)
    val font = FontFamily(Font(R.font.vt323))
}

internal fun style(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = Phosphor.font, fontSize = size.sp, color = color)

/** The twelve keys. Lit when they do something right now. Shared with the preview. */
@Composable
fun Keypad(modifier: Modifier = Modifier, compact: Boolean = false) {
    val ui by AppGraph.ui.collectAsStateWithLifecycle()
    val rows = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("*", "0", "#"))
    val ended = ui.phase == Phase.ENDED
    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 10.dp)) {
        for (r in rows) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 10.dp)) {
                for (k in r) {
                    val label = ui.keys[k]
                    val lit = label != null || ended
                    val locked = label == "locked"
                    Column(
                        Modifier.weight(1f).fillMaxSize()
                            .clip(RoundedCornerShape(12.dp))
                            .border(BorderStroke(if (lit) 2.dp else 1.dp, if (lit) Phosphor.fg else Phosphor.line), RoundedCornerShape(12.dp))
                            .background(Phosphor.panel)
                            .clickable { AppGraph.press(k) }
                            .semantics { contentDescription = "Key $k" + (label?.let { ": $it" } ?: "") }
                            .padding(4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(k, style = style(if (compact) 28 else 40, if (lit) Phosphor.hi else Phosphor.dim))
                        if (label != null) {
                            Text(
                                label,
                                style = style(if (compact) 13 else 16, if (locked) Phosphor.warn else Phosphor.fg),
                                maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
                            )
                        } else if (ended) Text("redial", style = style(if (compact) 13 else 16, Phosphor.dim))
                    }
                }
            }
        }
    }
}

@Composable
internal fun Button(text: String, modifier: Modifier = Modifier, primary: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier.height(52.dp)
            .border(1.dp, if (primary) Phosphor.fg else Phosphor.line)
            .background(if (primary) Phosphor.fg else Phosphor.panel)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = style(22, if (primary) Phosphor.bg else Phosphor.fg)) }
}

/** S / M / L / XL for the car screen's text. Lives on the phone: the phone is the car's controller. */
@Composable
fun CarTextSize(modifier: Modifier = Modifier) {
    val size by AppGraph.carText.collectAsStateWithLifecycle()
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("CAR TEXT", style = style(18, Phosphor.dim))
        AppGraph.CAR_TEXT_NAMES.forEachIndexed { i, name ->
            Box(
                Modifier.weight(1f).border(1.dp, if (i == size) Phosphor.fg else Phosphor.line)
                    .background(if (i == size) Phosphor.fg else Phosphor.panel)
                    .clickable { AppGraph.setCarTextSize(i) }
                    .semantics { contentDescription = "Car text size $name" }
                    .padding(vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) { Text(name, style = style(20, if (i == size) Phosphor.bg else Phosphor.fg)) }
        }
    }
}
