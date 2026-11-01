package com.jackie.dungeon

import android.app.Application
import android.util.Log
import com.jackie.dungeon.engine.StoryPack
import com.jackie.dungeon.story.PackBuilder
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.util.concurrent.Executors

/**
 * The stories on this phone, and the one being edited.
 *
 * Stories are saved as table rows (`files/stories/<id>.rows.json`) — the same
 * shape as Supabase, so sync can come later without a second model. The first
 * launch seeds the library from the rows bundled in `assets/rows/`.
 *
 * Every edit goes through [edit]: a pure function from [StoryEditor] applied to
 * the current rows, pushed on the undo stack, saved off the main thread, and
 * handed to the player as a fresh pack.
 */
object Studio {
    private const val TAG = "Studio"
    private const val UNDO_DEPTH = 100
    private lateinit var app: Application
    private val io = Executors.newSingleThreadExecutor { Thread(it, "jackie-io") }

    data class Meta(val id: String, val title: String, val scenes: Int)

    private val _stories = MutableStateFlow<List<Meta>>(emptyList())
    val stories: StateFlow<List<Meta>> = _stories

    private val _rows = MutableStateFlow<StoryRows?>(null)
    /** The open story, or null on the stories list. */
    val rows: StateFlow<StoryRows?> = _rows

    private val _undo = MutableStateFlow<List<Pair<String, StoryRows>>>(emptyList())
    /** Most recent last: what to call it, and the story before it. */
    val undo: StateFlow<List<Pair<String, StoryRows>>> = _undo

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    private val dir get() = File(app.filesDir, "stories").apply { mkdirs() }
    private fun file(id: String) = File(dir, "$id.rows.json")
    private val currentFile get() = File(app.filesDir, "current-story.txt")

    fun init(application: Application) {
        app = application
        seedOnce()
        refreshList()
        val last = runCatching { currentFile.readText().trim() }.getOrNull()
        val id = last?.takeIf { file(it).exists() } ?: _stories.value.firstOrNull { it.title.startsWith("William") }?.id ?: _stories.value.firstOrNull()?.id
        if (id != null) open(id, toPlayer = true)
    }

    /** First launch: copy the bundled stories in, so they can be edited. */
    private fun seedOnce() {
        val marker = File(app.filesDir, "stories/.seeded")
        if (marker.exists()) return
        for (name in app.assets.list("rows").orEmpty().filter { it.endsWith(".rows.json") }) {
            runCatching {
                val rows = StoryRows.parse(app.assets.open("rows/$name").bufferedReader().use { it.readText() })
                file(rows.story.id).writeText(rows.encode())
            }.onFailure { Log.w(TAG, "seed $name", it) }
        }
        marker.parentFile?.mkdirs(); marker.writeText("1")
    }

    private fun refreshList() {
        _stories.value = dir.listFiles { f -> f.name.endsWith(".rows.json") }.orEmpty().mapNotNull { f ->
            runCatching { StoryRows.parse(f.readText()) }.getOrNull()?.let { Meta(it.story.id, it.story.title, it.nodes.size) }
        }.sortedBy { it.title.lowercase() }
    }

    fun open(id: String, toPlayer: Boolean = true) {
        val rows = runCatching { StoryRows.parse(file(id).readText()) }.onFailure {
            _error.value = "That story couldn't be opened: ${it.message}"
        }.getOrNull() ?: return
        if (_rows.value?.story?.id != rows.story.id) CarEdit.reset()
        _rows.value = rows
        _undo.value = emptyList()
        runCatching { currentFile.writeText(id) }
        if (toPlayer) AppGraph.setStory(packOf(rows))
    }

    fun close() { _rows.value = null; refreshList() }

    fun create(title: String) {
        val rows = StoryEditor.newStory(title.ifBlank { "Untitled story" })
        file(rows.story.id).writeText(rows.encode())
        refreshList()
        open(rows.story.id)
    }

    fun exists(id: String) = file(id).exists()

    /** The saved rows of a story on this phone (not just the open one), for backing up. */
    fun load(id: String): StoryRows? = runCatching { StoryRows.parse(file(id).readText()) }.getOrNull()

    /** A restored story: saved into the library (replacing one with the same id) and opened. */
    fun install(rows: StoryRows) {
        file(rows.story.id).writeText(rows.encode())
        if (_rows.value?.story?.id == rows.story.id) _rows.value = null
        refreshList()
        open(rows.story.id)
    }

    fun reportError(message: String) { _error.value = message }

    fun deleteStory(id: String) {
        file(id).delete()
        if (_rows.value?.story?.id == id) _rows.value = null
        refreshList()
    }

    /**
     * Apply one edit. [label] is what Undo will say. A failed edit (deleting
     * the entrance, no free key) changes nothing and says why.
     */
    fun edit(label: String, f: (StoryRows) -> StoryRows): Boolean {
        val before = _rows.value ?: return false
        val after = try { f(before) } catch (e: Exception) { _error.value = e.message ?: "That didn't work."; return false }
        if (after == before) return true
        commit(after)
        _undo.value = (_undo.value + (label to before)).takeLast(UNDO_DEPTH)
        return true
    }

    /** For edits that also hand back an id (a new scene, a new door). */
    fun <T> editWith(label: String, f: (StoryRows) -> Pair<StoryRows, T>): T? {
        var out: T? = null
        edit(label) { r -> f(r).also { out = it.second }.first }
        return out
    }

    fun undo() {
        val stack = _undo.value
        val (_, before) = stack.lastOrNull() ?: return
        _undo.value = stack.dropLast(1)
        commit(before)
    }

    private fun commit(rows: StoryRows) {
        _rows.value = rows
        val text = rows.encode()
        val id = rows.story.id
        io.execute {
            runCatching {
                val tmp = File(dir, "$id.rows.json.tmp")
                tmp.writeText(text)
                tmp.renameTo(file(id))
            }.onFailure { Log.w(TAG, "save", it) }
        }
        AppGraph.storyEdited(packOf(rows))
    }

    fun clearError() { _error.value = null }

    /** The pack the player plays — built the way the web app builds it. */
    fun packOf(rows: StoryRows, startAt: String? = null): StoryPack {
        val pack = PackBuilder.build(rows, ::audioUrl)
        return if (startAt != null) pack.copy(root = startAt) else pack
    }

    /** Recordings made on the phone are files; ones from Supabase are paths in the public bucket. */
    fun audioUrl(path: String): String = when {
        path.startsWith("/") -> "file://$path"
        path.startsWith("http") || path.startsWith("file:") -> path
        else -> "https://tzfkylvtndgaugbgxbuc.supabase.co/storage/v1/object/public/story-audio/$path"
    }
}
