package com.jackie.dungeon.sync

import com.jackie.dungeon.story.StoryRows
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.util.UUID

/**
 * Keeps the phone's stories and the cloud's in step, a whole story at a time.
 *
 * The rules, as the author chose them:
 *   - changed only on the phone: the phone's version goes up;
 *   - changed only in the cloud (the web app, another phone): it comes down;
 *   - changed on both since the last sync: the newer edit wins;
 *   - a story only on one side is copied to the other;
 *   - the FIRST sync of a story that came from the cloud (William, JCFC)
 *     always sends the phone's version up — the cloud copies were older.
 *
 * Takes recorded on the phone are uploaded to `story-audio/<story id>/…` and
 * the cloud's rows point there; the phone's rows keep pointing at the local
 * file, so playback never needs the network. [SyncMeta.audio] remembers which
 * local file is which upload.
 */
object Sync {

    /** What the phone remembers about one story between syncs. */
    @Serializable
    data class SyncMeta(
        /** When the phone last changed it (epoch ms). */
        val localEditedAt: Long = 0,
        /** The [localEditedAt] that was last sent up or brought down. */
        val syncedLocalAt: Long = -1,
        /** The cloud's `edited_at` as of the last sync (ISO instant), or null if never synced. */
        val cloudSeen: String? = null,
        /** Local take path -> its path in the bucket. */
        val audio: Map<String, String> = emptyMap(),
    )

    /** The phone's side, as the sync sees it. */
    interface Library {
        fun stories(): List<StoryRows>
        fun meta(storyId: String): SyncMeta?
        fun setMeta(storyId: String, meta: SyncMeta)
        /** Save [rows]; when [oldId] differs, the story was re-keyed and the old one goes. */
        fun save(rows: StoryRows, oldId: String)
        /** Stories deleted on the phone that may still be in the cloud. */
        fun deleted(): Set<String>
        fun forget(storyId: String)
        fun readTake(path: String): ByteArray?
        /** Where a take downloaded for [bucketPath] would live, if it has been; null to stream it. */
        fun localTake(bucketPath: String): String? = null
    }

    data class Report(val pushed: List<String> = emptyList(), val pulled: List<String> = emptyList(), val deleted: List<String> = emptyList(), val errors: List<String> = emptyList()) {
        val quiet get() = pushed.isEmpty() && pulled.isEmpty() && deleted.isEmpty() && errors.isEmpty()
    }

    private val UUID_RE = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    fun isUuid(s: String) = UUID_RE.matches(s)

    /** Cloud stories this account can see: id -> (title, edited_at). */
    fun cloudStories(db: Supabase): Map<String, Pair<String, String>> =
        db.select("stories", "select=id,title,edited_at").associate { e ->
            val o = e.jsonObject
            o.s("id")!! to (o.s("title").orEmpty() to o.s("edited_at").orEmpty())
        }

    fun run(db: Supabase, lib: Library, now: () -> Long = { System.currentTimeMillis() }): Report {
        val pushed = ArrayList<String>(); val pulled = ArrayList<String>(); val removed = ArrayList<String>(); val errors = ArrayList<String>()
        val userId = db.session?.userId ?: throw SyncError("Not signed in.", 401)

        // Deleted on the phone: delete in the cloud too.
        var cloud = cloudStories(db)
        for (id in lib.deleted()) {
            runCatching { if (id in cloud) db.delete("stories", listOf(id)); lib.forget(id); removed += id }
                .onFailure { errors += "Deleting a story in the cloud: ${it.message}" }
        }
        cloud = cloud - removed.toSet()

        val claimed = HashSet<String>()
        for (local in lib.stories()) {
            val title = local.story.title.ifBlank { "Untitled story" }
            try {
                val meta = lib.meta(local.story.id) ?: SyncMeta()
                if (!isUuid(local.story.id) || meta.cloudSeen == null && local.story.id !in cloud) {
                    // Never synced. A story that came from the cloud under short ids
                    // finds its cloud copy by title, takes its ids, and replaces it.
                    val match = if (isUuid(local.story.id)) null else cloud.entries.firstOrNull { (id, v) -> v.first == local.story.title && id !in claimed }?.key
                    val linked = link(db, local, match)
                    if (linked.story.id != local.story.id) lib.save(linked, local.story.id)
                    val m = lib.meta(linked.story.id) ?: meta
                    claimed += linked.story.id
                    push(db, lib, linked, m, userId, now)
                    pushed += title
                    continue
                }
                claimed += local.story.id
                val c = cloud[local.story.id]
                val localChanged = meta.localEditedAt > meta.syncedLocalAt
                if (c == null) {
                    // Gone from the cloud (deleted on the web, or never made it): send it up again.
                    push(db, lib, local, meta, userId, now); pushed += title; continue
                }
                val cloudChanged = meta.cloudSeen == null || Instant.parse(normal(c.second)).isAfter(Instant.parse(normal(meta.cloudSeen)))
                when {
                    localChanged && cloudChanged ->
                        if (meta.localEditedAt >= Instant.parse(normal(c.second)).toEpochMilli()) { push(db, lib, local, meta, userId, now); pushed += title }
                        else { pull(db, lib, local.story.id, meta); pulled += title }
                    localChanged -> { push(db, lib, local, meta, userId, now); pushed += title }
                    cloudChanged -> { pull(db, lib, local.story.id, meta); pulled += title }
                }
            } catch (e: Exception) {
                errors += "$title: ${e.message}"
            }
        }
        // In the cloud and not on the phone: bring it down.
        for ((id, v) in cloud) {
            if (id in claimed) continue
            try { pull(db, lib, id, SyncMeta()); pulled += v.first } catch (e: Exception) { errors += "${v.first}: ${e.message}" }
        }
        return Report(pushed, pulled, removed, errors)
    }

    /**
     * Give a story cloud-shaped ids. With [cloudId], a phone copy of that cloud
     * story: each short id becomes the cloud id it is the start of (same table),
     * so the push replaces the cloud rows in place rather than duplicating them.
     * Anything without a match — and every id of a story made on the phone that
     * isn't a UUID yet — gets a fresh one.
     */
    fun link(db: Supabase, local: StoryRows, cloudId: String?): StoryRows {
        val map = HashMap<String, String>()
        if (cloudId != null) {
            map[local.story.id] = cloudId
            val remote = fetch(db, cloudId).idsByTable()
            for ((table, ids) in local.idsByTable()) {
                if (table == "stories") continue
                val candidates = remote[table].orEmpty()
                for (id in ids) if (!isUuid(id)) candidates.firstOrNull { it.startsWith(id) }?.let { map[id] = it }
            }
        }
        val all = local.idsByTable().values.flatten()
        for (id in all) if (id !in map && !isUuid(id)) map[id] = UUID.randomUUID().toString()
        return local.mapIds { map[it] ?: it }
    }

    /** Read a whole story from the cloud. */
    fun fetch(db: Supabase, id: String): StoryRows {
        val story = db.select("stories", "id=eq.$id&select=*").firstOrNull()?.jsonObject ?: throw SyncError("That story isn't in the cloud.")
        val tables = CloudRows.TABLES.associateWith { t -> db.select(t, "story_id=eq.$id&select=*&order=created_at.asc,id.asc") }
        return CloudRows.story(story, tables)
    }

    /**
     * Make the cloud's copy exactly the phone's: takes uploaded, rows the
     * cloud has and the phone doesn't deleted (children first), every row
     * upserted (parents first), and only then the entrance set.
     */
    fun push(db: Supabase, lib: Library, local: StoryRows, meta: SyncMeta, userId: String, now: () -> Long) {
        val id = local.story.id
        val startedAt = meta.localEditedAt
        // 1. Takes recorded on the phone, each uploaded once.
        val audio = meta.audio.toMutableMap()
        for (path in local.audioPaths().filter { it.startsWith("/") }.distinct()) {
            if (audio[path] != null) continue
            val bytes = lib.readTake(path) ?: continue
            val name = path.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._-]+"), "_")
            val target = "$id/phone/$name"
            db.upload(target, bytes)
            audio[path] = target
        }
        val up = local.mapAudio { p -> if (p.startsWith("/")) audio[p] else p }

        // 2. The story row (new stories need an owner; the entrance comes last).
        val exists = db.select("stories", "id=eq.$id&select=id,owner_id").firstOrNull()?.jsonObject
        if (exists == null) db.insert("stories", listOf(CloudRows.storyRow(up, userId, withRoot = false)))

        // 3. Deletes, children first, so nothing is left pointing at a row that's gone.
        val remote = if (exists == null) emptyMap() else CloudRows.TABLES.associateWith { t ->
            db.select(t, "story_id=eq.$id&select=id" + if (t in SLUGGED) ",slug" else "").map { it.jsonObject }
        }
        val mine = up.idsByTable()
        for (t in CloudRows.TABLES.reversed()) {
            val gone = remote[t].orEmpty().mapNotNull { it.s("id") }.filter { it !in mine[t].orEmpty() }
            if (gone.isNotEmpty()) db.delete(t, gone)
        }
        // 4. Slugs are unique per story: a row whose slug changed to one another row
        //    still holds would collide mid-upsert, so changed slugs step aside first.
        val rows = CloudRows.rows(up, Instant.ofEpochMilli(now() - 60_000L))
        for (t in SLUGGED) {
            val was = remote[t].orEmpty().associate { it.s("id") to it.s("slug") }
            for (r in rows[t].orEmpty()) {
                val rid = r.s("id") ?: continue
                val before = was[rid] ?: continue
                if (before != r.s("slug")) db.patch(t, "id=eq.$rid", JsonObject(mapOf("slug" to JsonPrimitive("ZSYNC_" + rid.replace("-", "").take(12).uppercase()))))
            }
        }
        // 5. Every row, parents first.
        for (t in CloudRows.TABLES) db.upsert(t, rows[t].orEmpty())
        // 6. The story itself, with its entrance — and the cloud's edit time, to compare next time.
        val after = db.patch("stories", "id=eq.$id", CloudRows.storyRow(up, null, withRoot = true)).firstOrNull()?.jsonObject
        val seen = after?.s("edited_at") ?: cloudStories(db)[id]?.second
        lib.setMeta(id, meta.copy(syncedLocalAt = startedAt, cloudSeen = seen, audio = audio))
    }

    /** Make the phone's copy the cloud's, keeping local files for takes uploaded from here. */
    fun pull(db: Supabase, lib: Library, id: String, meta: SyncMeta) {
        val remote = fetch(db, id)
        val back = meta.audio.entries.associate { (local, bucket) -> bucket to local }
        val rows = remote.mapAudio { p -> back[p] ?: lib.localTake(p) ?: p }
        val edited = cloudStories(db)[id]?.second
        lib.save(rows, id)
        val t = edited?.let { runCatching { Instant.parse(normal(it)).toEpochMilli() }.getOrNull() } ?: 0L
        lib.setMeta(id, meta.copy(localEditedAt = t, syncedLocalAt = t, cloudSeen = edited))
    }

    private val SLUGGED = setOf("nodes", "state_vars", "characters")

    /** Postgres writes `2026-11-01 12:24:36.96+00` or `…T…+00:00`; java.time wants ISO with a zone it reads. */
    fun normal(ts: String): String {
        var t = ts.trim().replace(' ', 'T')
        if (Regex("[+-]\\d\\d$").containsMatchIn(t)) t += ":00"
        return java.time.OffsetDateTime.parse(t).toInstant().toString()
    }

    private fun JsonObject.s(k: String): String? = this[k]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }?.takeIf { it != "null" }
}
