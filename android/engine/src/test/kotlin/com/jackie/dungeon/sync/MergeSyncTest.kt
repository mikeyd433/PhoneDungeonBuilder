package com.jackie.dungeon.sync

import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import com.jackie.dungeon.sync.FakeSupabase.Companion.s
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Two people, two phones, one story — both editing between syncs. Against
 * the fake Supabase, which keeps the real one's rules and memberships.
 */
class MergeSyncTest {
    private val fake = FakeSupabase()
    private var clockMs = Instant.parse("2026-11-01T13:00:00Z").toEpochMilli()

    private class Phone(val db: Supabase) : Sync.Library {
        val stories = LinkedHashMap<String, StoryRows>()
        val metas = HashMap<String, Sync.SyncMeta>()
        val bases = HashMap<String, StoryRows>()
        val tombstones = HashSet<String>()
        override fun stories() = stories.values.toList()
        override fun meta(storyId: String) = metas[storyId]
        override fun setMeta(storyId: String, meta: Sync.SyncMeta) { metas[storyId] = meta }
        override fun save(rows: StoryRows, oldId: String) {
            if (oldId != rows.story.id) { stories.remove(oldId); metas.remove(oldId)?.let { metas[rows.story.id] = it } }
            stories[rows.story.id] = rows
        }
        override fun deleted() = tombstones.toSet()
        override fun forget(storyId: String) { tombstones -= storyId }
        override fun readTake(path: String): ByteArray? = null
        override fun base(storyId: String) = bases[storyId]
        override fun setBase(storyId: String, rows: StoryRows?) { if (rows == null) bases.remove(storyId) else bases[storyId] = rows }
        fun edit(id: String, at: Long, f: (StoryRows) -> StoryRows) { stories[id] = f(stories[id]!!); metas[id] = (metas[id] ?: Sync.SyncMeta()).copy(localEditedAt = at) }
        fun only() = stories.values.single()
    }

    private fun phone(email: String): Phone {
        val db = Supabase("https://x.supabase.co", "anon", fake, now = { fake.clock.epochSecond })
        db.sendCode(email); db.verify(email, "123456")
        return Phone(db)
    }

    private fun sync(p: Phone) = Sync.run(p.db, p) { clockMs }

    /** My phone makes a story with two scenes and shares it with my friend, who syncs it down. */
    private fun shared(role: String = "writer"): Triple<Phone, Phone, String> {
        val me = phone("me@example.com")
        var r = StoryEditor.newStory("Shared")
        r = StoryEditor.addChoice(r, r.story.rootNodeId!!, "Mike's way", newScene = true).first
        r = StoryEditor.addChoice(r, r.story.rootNodeId!!, "Carter's way", newScene = true).first
        me.stories[r.story.id] = r; me.metas[r.story.id] = Sync.SyncMeta(localEditedAt = clockMs)
        sync(me)
        me.db.rpc("invite_to_story", mapOf("p_story" to r.story.id, "p_email" to "friend@example.com", "p_role" to role))
        val friend = phone("friend@example.com")
        assertEquals(listOf("Shared"), sync(friend).pulled)
        return Triple(me, friend, r.story.id)
    }

    private fun scene(p: Phone, label: String) = p.only().choices.first { it.label == label }.toNodeId!!

    @Test
    fun `two people editing different scenes both keep their work`() {
        val (me, friend, id) = shared()
        val mike = scene(me, "Mike's way"); val carter = scene(me, "Carter's way")
        me.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Mike in the swamp") }
        friend.edit(id, ++clockMs) { StoryEditor.setScript(it, carter, "Carter: Where are we?") }
        sync(me); sync(friend); sync(me)
        for (p in listOf(me, friend)) {
            val r = p.only()
            assertEquals("Mike in the swamp", r.nodes.first { it.id == mike }.title)
            assertEquals("Carter: Where are we?", r.nodes.first { it.id == carter }.narration)
        }
        assertEquals("Mike in the swamp", fake.t("nodes").first { it.s("id") == mike }.s("title"))
    }

    @Test
    fun `the same scene edited in different places keeps both, and the same field goes to the newer edit`() {
        val (me, friend, id) = shared()
        val mike = scene(me, "Mike's way")
        me.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Renamed by me") }
        friend.edit(id, ++clockMs) { StoryEditor.setScript(it, mike, "Friend's script") }
        sync(me); sync(friend); sync(me)
        assertEquals("Renamed by me", me.only().nodes.first { it.id == mike }.title)
        assertEquals("Friend's script", me.only().nodes.first { it.id == mike }.narration)

        // Both rename it before the other syncs: the later edit wins, whichever syncs first.
        me.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Mine, earlier") }
        friend.edit(id, clockMs + 3_600_000) { StoryEditor.updateScene(it, mike, title = "Theirs, later") }
        sync(me); sync(friend); sync(me)
        assertEquals("Theirs, later", me.only().nodes.first { it.id == mike }.title)
        assertEquals("Theirs, later", friend.only().nodes.first { it.id == mike }.title)
    }

    @Test
    fun `new scenes from both sides arrive, and two with one name get two names`() {
        val (me, friend, id) = shared()
        val root = me.only().story.rootNodeId!!
        me.edit(id, ++clockMs) { StoryEditor.addChoice(it, root, "Cave", newScene = true).first }
        friend.edit(id, ++clockMs) { StoryEditor.addChoice(it, root, "Cave", newScene = true).first }
        sync(me); val rep = sync(friend); sync(me)
        assertTrue(rep.errors.isEmpty(), rep.errors.toString())
        val caves = me.only().nodes.filter { it.title == "Cave" }
        assertEquals(2, caves.size, "both new scenes are kept")
        assertNotEquals(caves[0].slug, caves[1].slug)
        assertEquals(me.only().nodes.map { it.id }.toSet(), friend.only().nodes.map { it.id }.toSet())
        assertEquals(me.only().nodes.size, fake.t("nodes").size)
    }

    @Test
    fun `a scene one person deleted is gone, with the doors the other added out of it`() {
        val (me, friend, id) = shared()
        val mike = scene(me, "Mike's way")
        me.edit(id, ++clockMs) { StoryEditor.deleteScene(it, mike) }
        friend.edit(id, ++clockMs) { StoryEditor.addChoice(it, mike, "Deeper", newScene = true).first }
        sync(me); val rep = sync(friend); sync(me)
        assertTrue(rep.errors.isEmpty(), rep.errors.toString())
        for (p in listOf(me, friend)) {
            assertTrue(p.only().nodes.none { it.id == mike })
            assertTrue(p.only().choices.none { it.fromNodeId == mike }, "nothing left hanging off a deleted scene")
        }
        assertTrue(fake.t("nodes").none { it.s("id") == mike })
    }

    @Test
    fun `a viewer's phone only receives`() {
        val (me, friend, id) = shared(role = "viewer")
        val mike = scene(me, "Mike's way")
        friend.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Viewer tried this") }
        me.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Owner's change") }
        sync(me); val rep = sync(friend)
        assertTrue(rep.errors.isEmpty(), rep.errors.toString())
        assertEquals("Owner's change", friend.only().nodes.first { it.id == mike }.title)
        assertEquals("Owner's change", fake.t("nodes").first { it.s("id") == mike }.s("title"))
    }

    @Test
    fun `only what changed goes up`() {
        val (me, _, id) = shared()
        val mike = scene(me, "Mike's way")
        val before = fake.calls
        me.edit(id, ++clockMs) { StoryEditor.updateScene(it, mike, title = "Just this") }
        sync(me)
        // List stories, roles, fetch the story (12 tables), one upsert, the edit time: no table-wide rewrite.
        assertTrue(fake.calls - before < 22, "${fake.calls - before} calls")
        assertTrue(sync(me).quiet, "nothing changed since: nothing moves")
    }

    @Test
    fun `leaving a shared story takes you off it without deleting it for the owner`() {
        val (me, friend, id) = shared()
        friend.stories.remove(id); friend.tombstones += id
        sync(friend)
        assertNull(fake.role(id, fake.friend))
        assertTrue(fake.t("stories").any { it.s("id") == id }, "still there for the owner")
        assertTrue(sync(friend).pulled.isEmpty(), "and it doesn't come back")
        assertTrue(me.only().nodes.isNotEmpty())
    }

    @Test
    fun `an invite to someone without an account waits until they sign in`() {
        val me = phone("me@example.com")
        val r = StoryEditor.newStory("Later")
        me.stories[r.story.id] = r; me.metas[r.story.id] = Sync.SyncMeta(localEditedAt = clockMs)
        sync(me)
        assertEquals("\"invited\"", me.db.rpc("invite_to_story", mapOf("p_story" to r.story.id, "p_email" to "new@example.com", "p_role" to "writer")))
        val newcomer = phone("new@example.com")
        assertEquals(listOf("Later"), sync(newcomer).pulled)
        assertEquals("writer", fake.role(r.story.id, fake.accounts["new@example.com"]!!))
    }

    @Test
    fun `each phone sees which scene the other has open, until they go quiet`() {
        val (me, friend, id) = shared()
        val mike = scene(me, "Mike's way")
        Presence.here(friend.db, id, mike)
        Presence.here(me.db, id, null)
        val seen = Presence.others(me.db, id, fake.user, fake.clock)
        assertEquals(listOf(mike), seen.map { it.sceneId })
        assertEquals("Friend", seen.single().name)
        assertTrue(Presence.others(friend.db, id, fake.friend, fake.clock).single().sceneId == null, "I'm on the story with nothing open")
        assertTrue(Presence.others(me.db, id, fake.user, fake.clock.plusSeconds(60)).isEmpty(), "a minute without a word: gone")
    }
}
