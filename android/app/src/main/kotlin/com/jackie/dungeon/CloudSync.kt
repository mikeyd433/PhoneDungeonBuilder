package com.jackie.dungeon

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.jackie.dungeon.story.StoryRows
import com.jackie.dungeon.sync.Http
import com.jackie.dungeon.sync.Request
import com.jackie.dungeon.sync.Response
import com.jackie.dungeon.sync.Session
import com.jackie.dungeon.sync.Supabase
import com.jackie.dungeon.sync.Sync
import com.jackie.dungeon.sync.SyncError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.SetSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Keeps the stories on this phone in step with Supabase — automatically, a
 * few seconds after each edit, when the app opens, and when the connection
 * comes back. The rules live in [Sync] (pure, tested against a fake Supabase
 * in `SyncTest`); this object signs in, remembers what it needs between runs
 * (`files/sync/`), and runs one sync at a time on its own thread.
 */
object CloudSync {
    private const val TAG = "CloudSync"
    const val URL = "https://tzfkylvtndgaugbgxbuc.supabase.co"
    /** The project's publishable key — public by design, as in the web app. */
    private const val KEY = "sb_publishable_ENoH6QxlfhfUaSjOk80QkQ_uFarNZ07"
    private const val DEBOUNCE_MS = 5_000L

    enum class State { SIGNED_OUT, IDLE, WAITING, SYNCING, OFFLINE, ERROR }

    data class Status(
        val state: State = State.SIGNED_OUT,
        val email: String? = null,
        /** Epoch ms of the last sync that finished cleanly. */
        val lastSynced: Long = 0,
        val message: String? = null,
    )

    private lateinit var app: Application
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "jackie-sync") }
    private val main = Handler(Looper.getMainLooper())
    private var pending: ScheduledFuture<*>? = null
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _status = MutableStateFlow(Status())
    val status: StateFlow<Status> = _status

    private val dir get() = File(app.filesDir, "sync").apply { mkdirs() }
    private val metaFile get() = File(dir, "meta.json")
    private val goneFile get() = File(dir, "deleted.json")
    private val sessionFile get() = File(dir, "session.json")

    private val metas = HashMap<String, Sync.SyncMeta>()
    /** The story as of the last sync, per story: what a merge compares both sides against. */
    private fun baseFile(id: String) = File(File(dir, "base").apply { mkdirs() }, "$id.rows.json")

    /** This account's role on each story in the cloud: owner, writer, voice or viewer. */
    private val _roles = MutableStateFlow<Map<String, String>>(emptyMap())
    val roles: StateFlow<Map<String, String>> = _roles
    private val gone = HashSet<String>()

    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val http = Http { r -> send(r) }

    lateinit var db: Supabase
        private set

    fun init(application: Application) {
        app = application
        runCatching { metas.putAll(json.decodeFromString(MapSerializer(String.serializer(), Sync.SyncMeta.serializer()), metaFile.readText())) }
        runCatching { gone.addAll(json.decodeFromString(SetSerializer(String.serializer()), goneFile.readText())) }
        val session = runCatching { json.decodeFromString(Session.serializer(), sessionFile.readText()) }.getOrNull()
        db = Supabase(URL, KEY, http, session, onSession = ::keepSession)
        val last = app.getSharedPreferences("sync", Context.MODE_PRIVATE).getLong("lastSynced", 0)
        _status.value = Status(if (session == null) State.SIGNED_OUT else State.IDLE, session?.email, last)
        // When the connection comes back, catch up.
        runCatching {
            app.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { if (_status.value.state == State.OFFLINE || _status.value.state == State.WAITING) soon(1_000) }
            })
        }
        soon(2_000)
    }

    // ---- signing in -------------------------------------------------------------

    /** Where the emailed link brings the phone back to (on the project's Redirect URLs list). */
    const val REDIRECT = "jackiedungeon://login"

    /** Off the main thread. Throws [SyncError] with a readable message. */
    fun sendLink(email: String) = db.sendCode(email, REDIRECT)

    /** A code, if the project's email carries one. */
    fun verify(email: String, code: String) = signedIn(db.verify(email, code))

    /** The emailed link: where it landed (it opened this app), or the link itself, pasted. */
    fun signInWithLink(url: String) = signedIn(db.signInWithLink(url))

    private fun signedIn(s: Session) {
        _status.value = _status.value.copy(state = State.IDLE, email = s.email, message = null)
        soon(0)
    }

    /** The app was opened by the sign-in link. */
    fun openedByLink(url: String) = worker.execute {
        runCatching { signInWithLink(url) }.onFailure { e ->
            _status.value = _status.value.copy(state = if (db.session == null) State.SIGNED_OUT else _status.value.state, message = "Sign-in link: ${e.message}")
        }
    }

    fun signOut() {
        db.signOut()
        _status.value = Status(State.SIGNED_OUT)
    }

    private fun keepSession(s: Session?) {
        if (s == null) sessionFile.delete() else write(sessionFile, json.encodeToString(Session.serializer(), s))
    }

    // ---- what the rest of the app tells it ----------------------------------------

    /** A story was edited on this phone just now. */
    @Synchronized fun edited(storyId: String) {
        metas[storyId] = (metas[storyId] ?: Sync.SyncMeta()).copy(localEditedAt = System.currentTimeMillis())
        saveMeta()
        lively()
        if (db.session != null) {
            _status.value = _status.value.copy(state = State.WAITING)
            soon(DEBOUNCE_MS)
        }
    }

    /** A story was deleted on this phone: if the cloud has it, it goes there too. */
    @Synchronized fun deleted(storyId: String) {
        if (metas[storyId]?.cloudSeen != null) { gone += storyId; saveGone() }
        metas.remove(storyId); saveMeta()
        soon(DEBOUNCE_MS)
    }

    fun syncNow() = soon(0)

    // ---- live: while the app is open, notice changes made elsewhere -------------------

    /** Quick while something is happening — a friend in the story, an edit just made or just arrived. */
    private const val WATCH_BUSY_MS = 4_000L
    /** Otherwise: each look wakes the phone's radio, and a radio kept awake is a warm phone. */
    private const val WATCH_QUIET_MS = 15_000L
    /** How long "something just happened" lasts. */
    private const val BUSY_FOR_MS = 120_000L
    private var watcher: ScheduledFuture<*>? = null
    private var watching = false
    @Volatile private var busyUntil = 0L

    /** An edit here or a change from elsewhere: watch closely for a while. */
    fun lively() { busyUntil = System.currentTimeMillis() + BUSY_FOR_MS }

    /**
     * The app is on screen (true) or not. While it is, every few seconds one tiny
     * request asks the cloud when each story last changed; anything new — a
     * friend's edit, a story just shared — starts a sync, which merges it in.
     * Every 4 seconds while someone else is in the open story or anything changed
     * in the last two minutes; every 15 when it's just you (still inside presence's 25-second window, so friends keep seeing you).
     */
    @Synchronized fun foreground(on: Boolean) {
        if (!::db.isInitialized) return
        watching = on
        if (on && watcher == null) { lively(); watcher = worker.schedule(::look, WATCH_BUSY_MS, TimeUnit.MILLISECONDS) }
        if (!on) { watcher?.cancel(false); watcher = null }
    }

    @Synchronized private fun nextLook() {
        if (!watching) { watcher = null; return }
        val busy = _people.value.isNotEmpty() || System.currentTimeMillis() < busyUntil
        watcher = worker.schedule(::look, if (busy) WATCH_BUSY_MS else WATCH_QUIET_MS, TimeUnit.MILLISECONDS)
    }

    private fun look() {
        try { lookOnce() } finally { nextLook() }
    }

    private fun lookOnce() {
        if (db.session == null || _status.value.state == State.SYNCING) return
        runCatching {
            val cloud = Sync.cloudStories(db)
            val seen = synchronized(this) { metas.mapValues { it.value.cloudSeen } }
            val news = cloud.any { (id, v) ->
                val was = seen[id] ?: return@any true
                runCatching { java.time.Instant.parse(Sync.normal(v.second)).isAfter(java.time.Instant.parse(Sync.normal(was))) }.getOrDefault(true)
            }
            if (news) { lively(); runOnce() }
            lookForPeople()
            flushActivity()
            if (news || System.currentTimeMillis() - activityFetched > ACTIVITY_EVERY_MS) fetchActivity()
        }.onFailure { e -> if (e is SyncError && e.code == 0) _status.value = _status.value.copy(state = State.OFFLINE) }
    }

    // ---- who else is here ----------------------------------------------------------------

    private val _people = MutableStateFlow<List<com.jackie.dungeon.sync.Presence.Person>>(emptyList())
    /** Everyone else with the open story open right now, and the scene they're in. */
    val people: StateFlow<List<com.jackie.dungeon.sync.Presence.Person>> = _people

    /** Say where this phone is (the open story, the scene whose sheet is open) and see where everyone else is. */
    private fun lookForPeople() {
        val uid = db.session?.userId ?: return
        val open = Studio.rows.value?.story?.id
        if (open == null || !inCloud(open)) { publishPeople(emptyList()); return }
        // Before 0024_presence.sql there's nowhere to say it: no markers, no fuss.
        runCatching {
            com.jackie.dungeon.sync.Presence.here(db, open, CarEdit.state.value.phoneSheet)
            publishPeople(com.jackie.dungeon.sync.Presence.others(db, open, uid))
        }
    }

    private fun publishPeople(p: List<com.jackie.dungeon.sync.Presence.Person>) {
        if (_people.value != p) _people.value = p
        val bySceneName = p.filter { it.sceneId != null }.groupBy({ it.sceneId!! }, { it.name })
        main.post { CarEdit.others(bySceneName) }
    }

    // ---- the activity log ---------------------------------------------------------------

    private const val ACTIVITY_EVERY_MS = 30_000L
    private var activityFetched = 0L

    private val _activity = MutableStateFlow<List<com.jackie.dungeon.sync.Activity.Entry>>(emptyList())
    /** The open story's log, newest first: the cloud's (everyone's), plus this phone's not yet sent. */
    val activity: StateFlow<List<com.jackie.dungeon.sync.Activity.Entry>> = _activity

    /** This phone's own entries per story, kept on the phone (all of them when not signed in) and sent when it can. */
    private val local = HashMap<String, MutableList<com.jackie.dungeon.sync.Activity.Entry>>()
    private val unsent = HashMap<String, MutableList<com.jackie.dungeon.sync.Activity.Entry>>()
    private var cloudLog: Pair<String, List<com.jackie.dungeon.sync.Activity.Entry>>? = null
    private val activityDir get() = File(app.filesDir, "activity").apply { mkdirs() }

    /** Who "you" are in the log. */
    fun myId(): String? = if (::db.isInitialized) db.session?.userId else null

    /** An edit was made on this phone. Called on the main thread by [Studio]. */
    @Synchronized fun activity(storyId: String, label: String, sceneId: String?) {
        if (!::db.isInitialized) return
        val now = java.time.Instant.now()
        val mine = localOf(storyId)
        val last = mine.firstOrNull()
        // The same edit again within a minute (dragging a box in steps, retyping) is one entry.
        if (last != null && last.label == label && last.sceneId == sceneId && now.toEpochMilli() - last.at.toEpochMilli() < 60_000) {
            mine[0] = last.copy(at = now)
        } else {
            val e = com.jackie.dungeon.sync.Activity.Entry(myId(), db.session?.email ?: "", label, sceneId, now)
            mine.add(0, e)
            unsent.getOrPut(storyId) { ArrayList() }.add(e)
        }
        while (mine.size > 200) mine.removeAt(mine.size - 1)
        saveLocal(storyId)
        publishActivity(storyId)
        worker.execute { flushActivity() }
    }

    /** The open story changed: show its log. */
    fun activityFor(storyId: String?) {
        if (!::db.isInitialized) return
        if (storyId == null) { _activity.value = emptyList(); return }
        publishActivity(storyId)
        worker.execute { fetchActivity() }
    }

    private fun localOf(storyId: String) = local.getOrPut(storyId) {
        runCatching {
            File(activityDir, "$storyId.tsv").readLines().mapNotNull { l ->
                val p = l.split('\t'); if (p.size < 4) return@mapNotNull null
                com.jackie.dungeon.sync.Activity.Entry(myId(), p[1], p[2], p[3].ifEmpty { null }, java.time.Instant.ofEpochMilli(p[0].toLong()))
            }.toMutableList()
        }.getOrElse { ArrayList() }
    }

    private fun saveLocal(storyId: String) {
        val text = localOf(storyId).joinToString("\n") { "${it.at.toEpochMilli()}\t${it.email}\t${it.label.replace('\t', ' ').replace('\n', ' ')}\t${it.sceneId ?: ""}" }
        runCatching { File(activityDir, "$storyId.tsv").writeText(text) }
    }

    @Synchronized private fun publishActivity(storyId: String) {
        if (Studio.rows.value?.story?.id != storyId) return
        val cloud = cloudLog?.takeIf { it.first == storyId }?.second
        _activity.value = if (cloud == null) localOf(storyId).toList()
        else (cloud + unsent[storyId].orEmpty()).sortedByDescending { it.at }.take(100)
    }

    /** Send this phone's entries for stories that are in the cloud. On the worker. */
    private fun flushActivity() {
        if (db.session == null) return
        val todo = synchronized(this) { unsent.filter { (id, l) -> l.isNotEmpty() && inCloud(id) }.mapValues { it.value.toList() } }
        for ((id, list) in todo) {
            val sent = list.takeWhile { e -> runCatching { com.jackie.dungeon.sync.Activity.log(db, id, e.label, e.sceneId) }.isSuccess }
            if (sent.isNotEmpty()) synchronized(this) { unsent[id]?.removeAll(sent.toSet()) }
            if (sent.size < list.size) return // offline, or 0025 isn't there yet: try again later
        }
        if (todo.isNotEmpty()) fetchActivity()
    }

    /** The open story's log from the cloud. On the worker. */
    private fun fetchActivity() {
        activityFetched = System.currentTimeMillis()
        val open = Studio.rows.value?.story?.id ?: return
        if (db.session == null || !inCloud(open)) return
        runCatching { com.jackie.dungeon.sync.Activity.recent(db, open, 100) }.onSuccess { list ->
            synchronized(this) { cloudLog = open to list }
            main.post { publishActivity(open) }
        }
    }

    // ---- sharing ------------------------------------------------------------------------

    data class Member(val userId: String?, val email: String, val role: String, val pending: Boolean)

    /** Who is on a story. Off the main thread. */
    fun members(storyId: String): List<Member> {
        val text = db.rpc("story_members", mapOf("p_story" to storyId))
        return Json.parseToJsonElement(text).let { it as kotlinx.serialization.json.JsonArray }.map { e ->
            val o = e as kotlinx.serialization.json.JsonObject
            fun s(k: String) = (o[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
            Member(s("user_id"), s("email") ?: "", s("role") ?: "", (o["pending"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true")
        }
    }

    /** "added" (they have an account) or "invited" (waiting for them to sign in). Off the main thread. */
    fun invite(storyId: String, email: String, role: String): String =
        db.rpc("invite_to_story", mapOf("p_story" to storyId, "p_email" to email.trim(), "p_role" to role)).trim('"', ' ', '\n')

    fun removeMember(storyId: String, userId: String) { db.rpc("remove_story_member", mapOf("p_story" to storyId, "p_user" to userId)) }
    fun cancelInvite(storyId: String, email: String) { db.rpc("cancel_story_invite", mapOf("p_story" to storyId, "p_email" to email)) }

    /** Has this story reached the cloud yet (so it can be shared)? */
    fun inCloud(storyId: String) = synchronized(this) { metas[storyId]?.cloudSeen != null }

    // ---- running it ------------------------------------------------------------------

    @Synchronized private fun soon(delayMs: Long) {
        if (!::db.isInitialized || db.session == null) return
        pending?.cancel(false)
        pending = worker.schedule(::runOnce, delayMs, TimeUnit.MILLISECONDS)
    }

    @Volatile private var runStartedAt = 0L

    private fun runOnce() {
        if (db.session == null) return
        runStartedAt = System.currentTimeMillis()
        _status.value = _status.value.copy(state = State.SYNCING, message = null)
        try {
            val report = Sync.run(db, library)
            val at = System.currentTimeMillis()
            app.getSharedPreferences("sync", Context.MODE_PRIVATE).edit().putLong("lastSynced", at).apply()
            val msg = when {
                report.errors.isNotEmpty() -> report.errors.joinToString("\n")
                report.quiet -> null
                else -> buildList {
                    if (report.pushed.isNotEmpty()) add("Sent up: " + report.pushed.joinToString(", "))
                    if (report.pulled.isNotEmpty()) add("Brought down: " + report.pulled.joinToString(", "))
                    if (report.deleted.isNotEmpty()) add("Deleted in the cloud: ${report.deleted.size}")
                }.joinToString(" · ")
            }
            _status.value = _status.value.copy(state = if (report.errors.isEmpty()) State.IDLE else State.ERROR, lastSynced = at, message = msg)
            db.session?.userId?.let { uid -> runCatching { _roles.value = Sync.roles(db, uid) } }
        } catch (e: SyncError) {
            Log.w(TAG, "sync", e)
            when {
                e.code == 401 -> { db.signOut(); _status.value = Status(State.SIGNED_OUT, message = "Signed out: sign in again to keep syncing.") }
                e.code == 0 -> _status.value = _status.value.copy(state = State.OFFLINE, message = null)
                else -> { _status.value = _status.value.copy(state = State.ERROR, message = e.message); soon(60_000) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "sync", e)
            _status.value = _status.value.copy(state = State.ERROR, message = e.message ?: e.javaClass.simpleName)
        }
    }

    /** The phone's library as [Sync] sees it: the files, with the open story as it is in memory. */
    private val library = object : Sync.Library {
        override fun stories(): List<StoryRows> = onMain { Studio.allStories() }
        override fun meta(storyId: String) = synchronized(this@CloudSync) { metas[storyId] }
        override fun setMeta(storyId: String, meta: Sync.SyncMeta) = synchronized(this@CloudSync) {
            // An edit made while this sync ran is kept as unsynced.
            val now = metas[storyId]
            metas[storyId] = if (now != null && now.localEditedAt > meta.localEditedAt) meta.copy(localEditedAt = now.localEditedAt) else meta
            saveMeta()
        }
        override fun save(rows: StoryRows, oldId: String) {
            synchronized(this@CloudSync) {
                // Edited here while this sync was running: don't overwrite that; the next sync decides again.
                if (oldId == rows.story.id && (metas[oldId]?.localEditedAt ?: 0) > runStartedAt) return
                if (oldId != rows.story.id) metas.remove(oldId)?.let { metas[rows.story.id] = it; saveMeta() }
            }
            onMain { Studio.replaceFromSync(rows, oldId) }
        }
        override fun deleted(): Set<String> = synchronized(this@CloudSync) { gone.toSet() }
        override fun forget(storyId: String) = synchronized(this@CloudSync) { gone -= storyId; saveGone(); baseFile(storyId).delete(); Unit }
        override fun readTake(path: String): ByteArray? = File(path).takeIf { it.exists() }?.readBytes()
        override fun base(storyId: String): StoryRows? = runCatching { StoryRows.parse(baseFile(storyId).readText()) }.getOrNull()
        override fun setBase(storyId: String, rows: StoryRows?) { if (rows == null) baseFile(storyId).delete() else write(baseFile(storyId), rows.encode()) }
    }

    private fun <T> onMain(f: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return f()
        var out: Result<T>? = null
        val done = CountDownLatch(1)
        main.post { out = runCatching(f); done.countDown() }
        done.await(30, TimeUnit.SECONDS)
        return (out ?: error("The app was busy.")).getOrThrow()
    }

    private fun saveMeta() = write(metaFile, json.encodeToString(MapSerializer(String.serializer(), Sync.SyncMeta.serializer()), metas))
    private fun saveGone() = write(goneFile, json.encodeToString(SetSerializer(String.serializer()), gone))
    private fun write(f: File, text: String) { val tmp = File(f.path + ".tmp"); tmp.writeText(text); tmp.renameTo(f) }

    private val noRedirects by lazy { client.newBuilder().followRedirects(false).followSslRedirects(false).build() }

    private fun send(r: Request): Response {
        val body = r.body?.toRequestBody(r.headers["Content-Type"]?.toMediaTypeOrNull())
            ?: if (r.method in setOf("POST", "PATCH", "PUT")) ByteArray(0).toRequestBody(null) else null
        val req = okhttp3.Request.Builder().url(r.url).method(r.method, body).apply { r.headers.forEach { (k, v) -> header(k, v) } }.build()
        return try {
            (if (r.followRedirects) client else noRedirects).newCall(req).execute().use { res ->
                Response(res.code, res.body?.string().orEmpty(), res.headers.toMultimap().mapValues { it.value.joinToString(",") })
            }
        } catch (e: IOException) {
            throw SyncError("No connection.", 0)
        }
    }
}
