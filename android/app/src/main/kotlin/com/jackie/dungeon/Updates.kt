package com.jackie.dungeon

import android.app.Activity
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * "A newer build is out": asked of Google Play each time the phone app comes to
 * the front, so a tester on the internal track hears about it without opening
 * the Play Store. UPDATE downloads it in the background (the story stays usable);
 * when it's down, RESTART installs it.
 *
 * Only an install from Play can be told — a debug build or a sideloaded APK
 * just never sees an update, and nothing shows.
 */
object Updates {
    sealed interface State {
        data object None : State
        data class Available(val versionCode: Int) : State
        data class Downloading(val percent: Int) : State
        data object Ready : State
    }

    private val _state = MutableStateFlow<State>(State.None)
    val state: StateFlow<State> = _state

    /** Hidden until the next launch (or a newer build than the one dismissed). */
    private var dismissed = 0

    private var manager: AppUpdateManager? = null
    private var info: AppUpdateInfo? = null

    private val listener = InstallStateUpdatedListener { s ->
        when (s.installStatus()) {
            InstallStatus.DOWNLOADING -> {
                val total = s.totalBytesToDownload()
                _state.value = State.Downloading(if (total > 0) (s.bytesDownloaded() * 100 / total).toInt() else 0)
            }
            InstallStatus.DOWNLOADED -> _state.value = State.Ready
            InstallStatus.FAILED, InstallStatus.CANCELED -> info?.let { _state.value = State.Available(it.availableVersionCode()) }
            else -> Unit
        }
    }

    /** The phone app came to the front. */
    fun check(activity: Activity) {
        val m = manager ?: AppUpdateManagerFactory.create(activity.applicationContext).also { manager = it; it.registerListener(listener) }
        m.appUpdateInfo.addOnSuccessListener { i ->
            info = i
            _state.value = when {
                i.installStatus() == InstallStatus.DOWNLOADED -> State.Ready
                i.installStatus() == InstallStatus.DOWNLOADING -> State.Downloading(0)
                i.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE && i.availableVersionCode() != dismissed -> State.Available(i.availableVersionCode())
                else -> State.None
            }
        }.addOnFailureListener { Log.i("Updates", "no update check: ${it.message}") }
    }

    /** UPDATE: in the background if Play allows it, otherwise Play's own full-screen update. */
    fun start(launcher: ActivityResultLauncher<IntentSenderRequest>) {
        val m = manager ?: return
        val i = info ?: return
        val type = if (i.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) AppUpdateType.FLEXIBLE else AppUpdateType.IMMEDIATE
        runCatching { m.startUpdateFlowForResult(i, launcher, AppUpdateOptions.newBuilder(type).build()) }
            .onFailure { Log.w("Updates", "start", it) }
    }

    /** RESTART: installs the downloaded build; the app reopens on it. */
    fun install() { manager?.completeUpdate() }

    fun dismiss() {
        (state.value as? State.Available)?.let { dismissed = it.versionCode }
        _state.value = State.None
    }

    fun declined() { info?.let { if (_state.value !is State.Ready) _state.value = State.Available(it.availableVersionCode()) } }
}
