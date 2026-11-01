package com.jackie.dungeon.story

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class BackupTest {
    private val william = StoryRows.parse(javaClass.getResource("/golden/william.rows.json")!!.readText())

    /** William with a few takes recorded on "this phone", two of them with the same file name. */
    private fun recorded(): StoryRows {
        var r = william
        val n = r.nodes
        r = StoryEditor.setSceneTake(r, n[0].id, "/data/user/0/com.jackie.dungeon/files/audio/w/START-1.wav", 1200)
        r = StoryEditor.setSceneTake(r, n[1].id, "/data/user/0/com.jackie.dungeon/files/audio/other/START-1.wav", 900)
        r = StoryEditor.setReplyTake(r, r.choices[0].id, "/data/user/0/com.jackie.dungeon/files/audio/w/reply.wav", 500)
        return r
    }

    @Test
    fun `a backup carries every take recorded on the phone and leaves bucket paths alone`() {
        val r = recorded()
        val p = Backup.pack(r)
        assertEquals(3, p.files.size)
        assertEquals(3, p.files.values.toSet().size, "two files with one name get two names in the zip")
        assertTrue(p.rows.audioPaths().none { Backup.isLocal(it) }, "nothing in the backup points at this phone")
        // The kitchen's takes are bucket paths (William's came over unrecorded).
        val kitchen = StoryRows.parse(javaClass.getResource("/golden/kitchen.rows.json")!!.readText())
        val bucket = kitchen.audioPaths()
        assertTrue(bucket.isNotEmpty())
        assertEquals(kitchen, Backup.pack(kitchen).rows, "takes that came from Supabase stay as they were")
    }

    @Test
    fun `restoring puts every take back where the new phone keeps it, and the story round-trips`() {
        val r = recorded()
        val p = Backup.pack(r)
        val text = p.rows.encode()
        val back = Backup.unpack(StoryRows.parse(text)) { "/new/phone/audio/${r.story.id}/$it" }
        val local = back.audioPaths().filter { it.startsWith("/new/phone/") }
        assertEquals(3, local.size)
        // Apart from where the takes live, it's the same story.
        assertEquals(r.mapAudio { if (Backup.isLocal(it)) "x" else it }, back.mapAudio { if (it.startsWith("/new/")) "x" else it })
        PackBuilder.build(back)
    }

    @Test
    fun `kept as a copy, it is a separate story`() {
        val c = Backup.asCopy(william)
        assertNotEquals(william.story.id, c.story.id)
        assertEquals("William Son of Joel (restored)", c.story.title)
        assertEquals(william.nodes, c.nodes)
    }

    @Test
    fun `something that isn't a backup is refused with a reason`() {
        assertFailsWith<IllegalArgumentException> { Backup.check(Backup.Manifest(format = "other", title = "", storyId = "", savedAt = "", scenes = 0, takes = 0)) }
        assertFailsWith<IllegalArgumentException> { Backup.check(Backup.Manifest(version = 99, title = "", storyId = "", savedAt = "", scenes = 0, takes = 0)) }
        assertEquals("william-son-of-joel-backup-2026-11-01.jdbackup.zip", Backup.fileName("William Son of Joel", "2026-11-01"))
    }
}
