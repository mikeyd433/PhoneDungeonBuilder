package com.jackie.dungeon.ui

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.jackie.dungeon.CloudSync
import com.jackie.dungeon.CloudSync.State
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun mono(size: Int, color: Color = Phosphor.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, color = color)

/** One line saying where the cloud stands, with what to do about it. */
fun syncLine(s: CloudSync.Status): Pair<String, Color> = when (s.state) {
    State.SIGNED_OUT -> "Not syncing: sign in to keep your stories in the cloud" to Phosphor.warn
    State.SYNCING -> "Syncing…" to Phosphor.cyan
    State.WAITING -> "Changes waiting to sync" to Phosphor.dim
    State.OFFLINE -> "Offline: will sync when the connection is back" to Phosphor.warn
    State.ERROR -> "Sync problem: ${s.message ?: "unknown"}" to Phosphor.alert
    State.IDLE -> (if (s.lastSynced == 0L) "Signed in" else "Synced " + DateUtils.getRelativeTimeSpanString(s.lastSynced, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)) to Phosphor.dim
}

/** On the stories list: the cloud's state, SYNC NOW, and signing in or out. */
@Composable
fun SyncBar(modifier: Modifier = Modifier) {
    val s by CloudSync.status.collectAsStateWithLifecycle()
    var signingIn by remember { mutableStateOf(false) }
    var confirmOut by remember { mutableStateOf(false) }
    Column(modifier.border(1.dp, Phosphor.line).background(Phosphor.panel).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("☁ CLOUD", style = style(20, Phosphor.hi))
            Text(s.email ?: "", style = mono(12, Phosphor.dim), modifier = Modifier.weight(1f))
            if (s.state == State.SIGNED_OUT) Text("SIGN IN", style = style(20, Phosphor.bg), modifier = Modifier.background(Phosphor.fg).clickable { signingIn = true }.padding(horizontal = 10.dp, vertical = 4.dp))
            else {
                Text("SYNC NOW", style = style(18, Phosphor.fg), modifier = Modifier.border(1.dp, Phosphor.line).clickable { CloudSync.syncNow() }.padding(horizontal = 8.dp, vertical = 4.dp))
                Text("sign out", style = mono(12, Phosphor.dim), modifier = Modifier.clickable { confirmOut = true }.padding(4.dp))
            }
        }
        val (line, color) = syncLine(s)
        Text(line, style = mono(12, color))
        if (s.state == State.IDLE && s.message != null) Text(s.message!!, style = mono(11, Phosphor.dim))
    }
    if (signingIn) SignInDialog { signingIn = false }
    if (confirmOut) Confirm("Sign out? Stories stay on this phone; they just stop syncing until you sign in again.", "Sign out") { yes -> confirmOut = false; if (yes) CloudSync.signOut() }
}

/**
 * Sign in with the account the web app uses: type the email, get a code by
 * email, type the code. (The sign-in email's template carries the code as
 * `{{ .Token }}` — see android/README.md.)
 */
@Composable
fun SignInDialog(onDone: () -> Unit) {
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var sent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    fun attempt(f: () -> Unit, then: () -> Unit) {
        busy = true; error = null
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching(f) }
            busy = false
            r.onSuccess { then() }.onFailure { error = it.message ?: "That didn't work." }
        }
    }
    Dialog(onDismissRequest = onDone) {
        Column(Modifier.border(1.dp, Phosphor.fg).background(Phosphor.bg).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("SIGN IN TO SYNC", style = style(22, Phosphor.hi))
            Text("Use the email you sign in to the web app with.", style = mono(13, Phosphor.dim))
            Input(email, { email = it }, "you@example.com", KeyboardType.Email, enabled = !sent)
            if (sent) {
                Text("A code is on its way to $email. Type it here:", style = mono(13, Phosphor.fg))
                Input(code, { code = it.filter(Char::isDigit).take(10) }, "123456", KeyboardType.Number)
            }
            error?.let { Text(it, style = mono(13, Phosphor.alert)) }
            if (busy) Text("…", style = mono(14, Phosphor.cyan))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button("CANCEL", Modifier.weight(1f)) { onDone() }
                if (!sent) Button("SEND CODE", Modifier.weight(1f), primary = true) {
                    if (email.contains('@') && !busy) attempt({ CloudSync.sendCode(email) }) { sent = true }
                } else Button("SIGN IN", Modifier.weight(1f), primary = true) {
                    if (code.length >= 6 && !busy) attempt({ CloudSync.verify(email, code) }) { onDone() }
                }
            }
            if (sent) Text("Send another code", style = mono(12, Phosphor.cyan), modifier = Modifier.clickable { if (!busy) attempt({ CloudSync.sendCode(email) }) {} }.padding(vertical = 4.dp))
        }
    }
}

@Composable
private fun Input(value: String, onChange: (String) -> Unit, hint: String, type: KeyboardType, enabled: Boolean = true) {
    Box(Modifier.fillMaxWidth().border(1.dp, Phosphor.line).padding(10.dp)) {
        if (value.isEmpty()) Text(hint, style = mono(16, Phosphor.dim))
        BasicTextField(value, onChange, textStyle = mono(16, if (enabled) Phosphor.fg else Phosphor.dim), cursorBrush = SolidColor(Phosphor.fg), singleLine = true,
            enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = type), modifier = Modifier.fillMaxWidth())
    }
}
