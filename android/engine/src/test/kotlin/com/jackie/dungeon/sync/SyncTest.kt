package com.jackie.dungeon.sync

import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.PackBuilder
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import com.jackie.dungeon.sync.FakeSupabase.Companion.s
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The sync, against an in-memory Supabase that keeps the real one's rules. */
class SyncTest {
    private fun rows(name: String) = StoryRows.parse(javaClass.getResource("/golden/$name.rows.json")!!.readText())

    /** The phone's library, in memory. */
    private class Lib : Sync.Library {
        val stories = LinkedHashMap<String, StoryRows>()
        val metas = HashMap<String, Sync.SyncMeta>()
        val tombstones = HashSet<String>()
        val takes = HashMap<String, ByteArray>()
        override fun stories() = stories.values.toList()
        override fun meta(storyId: String) = metas[storyId]
        override fun setMeta(storyId: String, meta: Sync.SyncMeta) { metas[storyId] = meta }
        override fun save(rows: StoryRows, oldId: String) {
            if (oldId != rows.story.id) { stories.remove(oldId); metas.remove(oldId)?.let { metas[rows.story.id] = it } }
            stories[rows.story.id] = rows
        }
        override fun deleted() = tombstones.toSet()
        override fun forget(storyId: String) { tombstones -= storyId }
        override fun readTake(path: String) = takes[path]
        /** An edit on the phone, as Studio records it. */
        fun edit(id: String, at: Long, f: (StoryRows) -> StoryRows) {
            stories[id] = f(stories[id]!!)
            metas[id] = (metas[id] ?: Sync.SyncMeta()).copy(localEditedAt = at)
        }
    }

    private val fake = FakeSupabase()
    private var nowMs = Instant.parse("2026-11-01T13:00:00Z").toEpochMilli()
    private val db = Supabase("https://x.supabase.co", "anon", fake, now = { fake.clock.epochSecond })
    private fun signIn() { db.sendCode("me@example.com"); db.verify("me@example.com", "123456") }
    private fun run(lib: Lib) = Sync.run(db, lib) { nowMs }

    /** The cloud's William: the fixture with its full ids (the fixture keeps their first 7 characters). */
    private fun seedCloud(r: StoryRows, edited: String = "2026-08-04T16:46:18Z"): StoryRows {
        val full = r.mapIds { id -> if (Sync.isUuid(id)) id else id.padEnd(8, '0').take(8) + "-0000-4000-8000-" + "%012x".format(id.hashCode().toLong() and 0xffffffffffffL) }
            .let { it.copy(story = it.story.copy(id = "d7fcec45-067d-47c1-81d9-09ea78820ea6")) }
        fake.t("stories") += JsonObjectOf(CloudRows.storyRow(full, fake.user, true), "edited_at" to edited)
        for ((t, rs) in CloudRows.rows(full, Instant.parse("2026-08-01T00:00:00Z"))) fake.t(t) += rs
        return full
    }

    private fun JsonObjectOf(o: kotlinx.serialization.json.JsonObject, vararg kv: Pair<String, String>) =
        kotlinx.serialization.json.JsonObject(o + kv.associate { (k, v) -> k to JsonPrimitive(v) })

    @Test
    fun `signing in takes the emailed code, and a wrong one says so`() {
        db.sendCode("me@example.com")
        val e = assertFailsWith<SyncError> { db.verify("me@example.com", "000000") }
        assertTrue("invalid" in e.message!!, e.message)
        val s = db.verify("me@example.com", "123456")
        assertEquals(fake.user, s.userId)
        // An hour later the token is refreshed on the way, without asking again.
        fake.clock = fake.clock.plusSeconds(3600)
        db.select("stories", "select=id")
        assertEquals("token-refreshed", db.session!!.accessToken)
    }

    @Test
    fun `signing in with the emailed link, opened in the app or pasted in`() {
        // Opened on the phone: the app gets the landing address.
        db.sendCode("me@example.com", redirectTo = "jackiedungeon://login")
        val opened = db.signInWithLink("jackiedungeon://login#access_token=token-first&expires_at=${fake.clock.epochSecond + 3600}&refresh_token=r-first&token_type=bearer&type=magiclink".also { fake.send(Request("POST", "https://x.supabase.co/auth/v1/verify", emptyMap(), """{"token":"123456"}""".toByteArray())) })
        assertEquals(fake.user, opened.userId)
        assertEquals("me@example.com", opened.email)
        // Pasted: the app follows the link one step and reads the session off the redirect.
        db.signOut()
        val pasted = db.signInWithLink("https://x.supabase.co/auth/v1/verify?token=good&type=magiclink&redirect_to=https://dabingabongo.com/delve")
        assertEquals("token-link", pasted.accessToken)
        db.select("stories", "select=id") // and it works
        val used = assertFailsWith<SyncError> { db.signInWithLink("https://x.supabase.co/auth/v1/verify?token=used&type=magiclink") }
        assertTrue("expired" in used.message!!, used.message)
        assertFailsWith<SyncError> { db.signInWithLink("hello") }
    }

    @Test
    fun `the first sync replaces the cloud's William in place with the phone's`() {
        val cloud = seedCloud(rows("william"))
        signIn()
        val lib = Lib()
        var phone = rows("william")
        // Work done on the phone since: a new scene behind a new door, and a chapter.
        val (p1, door) = StoryEditor.addChoice(phone, phone.story.rootNodeId!!, "A new way", newScene = true)
        phone = StoryEditor.setChapter(p1, setOf(phone.story.rootNodeId!!), "Intro")
        lib.stories["william"] = phone

        val report = run(lib)
        assertEquals(listOf("William Son of Joel"), report.pushed, report.errors.toString())
        assertTrue(report.errors.isEmpty())
        val local = lib.stories.values.single()
        assertEquals(cloud.story.id, local.story.id, "the phone's copy now has the cloud's id")
        assertEquals(cloud.nodes.size + 1, fake.t("nodes").size, "same scenes, plus the new one — nothing duplicated")
        assertEquals(cloud.nodes.map { it.id }.toSet(), fake.t("nodes").mapNotNull { it.s("id") }.toSet() - local.nodes.last().id)
        assertEquals("Intro", fake.t("nodes").first { it.s("id") == local.story.rootNodeId }.s("chapter"))
        assertEquals(1, fake.t("stories").size)
        // What comes back down is what went up.
        val back = Sync.fetch(db, local.story.id)
        assertEquals(local.nodes.map { it.id }, back.nodes.map { it.id }, "rows come back in the phone's order")
        assertEquals(PackBuilder.build(local), PackBuilder.build(back))
        assertTrue(fake.t("choices").any { it.s("id") == local.choices.first { c -> c.label == "A new way" }.id })
        assertTrue(door.isNotEmpty())
    }

    @Test
    fun `afterwards only what changed moves, and newest wins`() {
        seedCloud(rows("william")); signIn()
        val lib = Lib(); lib.stories["william"] = rows("william")
        run(lib)
        val id = lib.stories.keys.single()
        assertTrue(run(lib).quiet, "nothing changed, nothing moves")

        // Phone edit only: goes up.
        lib.edit(id, ++nowMs) { StoryEditor.updateScene(it, it.story.rootNodeId!!, title = "Phone title") }
        assertEquals(1, run(lib).pushed.size)
        assertEquals("Phone title", fake.t("nodes").first { it.s("id") == lib.stories[id]!!.story.rootNodeId }.s("title"))

        // Cloud edit only (the web app): comes down.
        val root = lib.stories[id]!!.story.rootNodeId!!
        fake.setRow("nodes", root, mapOf("title" to JsonPrimitive("Web title"))); fake.bump(id)
        assertEquals(1, run(lib).pulled.size)
        assertEquals("Web title", lib.stories[id]!!.nodes.first { it.id == root }.title)

        // Both: the newer edit wins. The phone edits after the web does.
        fake.setRow("nodes", root, mapOf("title" to JsonPrimitive("Older web title"))); fake.bump(id)
        lib.edit(id, fake.clock.toEpochMilli() + 5_000) { StoryEditor.updateScene(it, root, title = "Newer phone title") }
        assertEquals(1, run(lib).pushed.size)
        assertEquals("Newer phone title", fake.t("nodes").first { it.s("id") == root }.s("title"))

        // Both, the other way round.
        lib.edit(id, fake.clock.toEpochMilli() - 60_000) { StoryEditor.updateScene(it, root, title = "Older phone title") }
        fake.setRow("nodes", root, mapOf("title" to JsonPrimitive("Newer web title"))); fake.bump(id)
        assertEquals(1, run(lib).pulled.size)
        assertEquals("Newer web title", lib.stories[id]!!.nodes.first { it.id == root }.title)
    }

    @Test
    fun `deleting on the phone deletes in the cloud, and rows removed on the phone are removed there`() {
        seedCloud(rows("william")); signIn()
        val lib = Lib(); lib.stories["william"] = rows("william")
        run(lib)
        val id = lib.stories.keys.single()
        val doomed = lib.stories[id]!!.nodes.first { it.slug == "FOREST_2" }.id
        lib.edit(id, ++nowMs) { StoryEditor.deleteScene(it, doomed) }
        run(lib)
        assertTrue(fake.t("nodes").none { it.s("id") == doomed })
        assertEquals(lib.stories[id]!!.choices.size, fake.t("choices").size)

        lib.stories.remove(id); lib.tombstones += id
        assertEquals(listOf(id), run(lib).deleted)
        assertTrue(fake.t("stories").isEmpty() && fake.t("nodes").isEmpty())
    }

    @Test
    fun `a story made on the phone goes up under this account, and one only in the cloud comes down`() {
        signIn()
        val lib = Lib()
        val mine = StoryEditor.newStory("Made on the phone")
        lib.stories[mine.story.id] = mine
        lib.metas[mine.story.id] = Sync.SyncMeta(localEditedAt = nowMs)
        run(lib)
        assertEquals(fake.user, fake.t("stories").single().s("owner_id"))

        // A second phone, empty: it gets the story.
        val other = Lib()
        assertEquals(listOf("Made on the phone"), run(other).pulled)
        assertEquals(mine.nodes.map { it.slug }, other.stories.values.single().nodes.map { it.slug })
    }

    @Test
    fun `takes recorded on the phone are uploaded once, and the phone keeps playing its own files`() {
        signIn()
        val lib = Lib()
        var r = StoryEditor.newStory("Recorded")
        r = StoryEditor.setSceneTake(r, r.story.rootNodeId!!, "/data/files/audio/x/START-1.wav", 900)
        lib.stories[r.story.id] = r
        lib.takes["/data/files/audio/x/START-1.wav"] = ByteArray(64) { 7 }
        lib.metas[r.story.id] = Sync.SyncMeta(localEditedAt = nowMs)
        run(lib)
        assertEquals(setOf("${r.story.id}/phone/START-1.wav"), fake.files.keys)
        assertEquals("${r.story.id}/phone/START-1.wav", fake.t("nodes").single().s("audio_path"))
        assertEquals("/data/files/audio/x/START-1.wav", lib.stories[r.story.id]!!.nodes.single().audioPath)

        // An edit elsewhere comes down without losing the local file, and nothing is uploaded twice.
        fake.setRow("nodes", r.story.rootNodeId!!, mapOf("title" to JsonPrimitive("Renamed on the web"))); fake.bump(r.story.id)
        run(lib)
        assertEquals("/data/files/audio/x/START-1.wav", lib.stories[r.story.id]!!.nodes.single().audioPath)
        lib.edit(r.story.id, nowMs + 10_000_000) { StoryEditor.updateScene(it, r.story.rootNodeId!!, title = "Again") }
        val before = fake.calls
        run(lib)
        assertEquals(1, fake.files.size)
        assertTrue(fake.calls > before)
    }

    @Test
    fun `slugs can swap between two scenes without tripping the unique rule`() {
        signIn()
        val lib = Lib()
        var r = StoryEditor.newStory("Swaps")
        val (r1, d) = StoryEditor.addChoice(r, r.story.rootNodeId!!, "Next", newScene = true); r = r1
        lib.stories[r.story.id] = r; lib.metas[r.story.id] = Sync.SyncMeta(localEditedAt = nowMs)
        run(lib)
        val a = r.nodes[0]; val b = r.nodes[1]
        lib.edit(r.story.id, nowMs + 10_000_000) { x -> x.copy(nodes = x.nodes.map { if (it.id == a.id) it.copy(slug = b.slug) else if (it.id == b.id) it.copy(slug = a.slug) else it }) }
        val rep = run(lib)
        assertTrue(rep.errors.isEmpty(), rep.errors.toString())
        assertEquals(b.slug, fake.t("nodes").first { it.s("id") == a.id }.s("slug"))
        assertTrue(d.isNotEmpty())
    }

    @Test
    fun `a fork left with nowhere to go goes up as a refusal rather than failing the sync`() {
        signIn()
        val lib = Lib()
        var r = StoryEditor.newStory("Forks")
        val (r1, door) = StoryEditor.addChoice(r, r.story.rootNodeId!!, "Climb", newScene = true); r = r1
        val (r2, item) = StoryEditor.addItem(r, "Rope"); r = r2
        r = StoryEditor.setNeed(r, door, StoryEditor.Need(listOf(item.slug)), "divert", failNode = null)
        lib.stories[r.story.id] = r; lib.metas[r.story.id] = Sync.SyncMeta(localEditedAt = nowMs)
        val rep = run(lib)
        assertTrue(rep.errors.isEmpty(), rep.errors.toString())
        assertEquals("refuse", fake.t("gates").single().s("fail_behavior"))
        assertNull(fake.t("gates").single().s("fail_node_id"))
    }

    @Test
    fun `nothing happens signed out`() {
        val e = assertFailsWith<SyncError> { run(Lib()) }
        assertEquals(401, e.code)
        assertFalse(fake.calls > 0)
        assertNotEquals("", Sync.normal("2026-11-01 12:24:36.960428+00"))
        assertEquals(Instant.parse("2026-11-01T12:24:36.960428Z").toString(), Sync.normal("2026-11-01 12:24:36.960428+00"))
        assertTrue(FlowLayout.W > 0)
    }
}
