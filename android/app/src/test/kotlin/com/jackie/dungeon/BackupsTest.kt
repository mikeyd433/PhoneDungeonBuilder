package com.jackie.dungeon

import android.net.Uri
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.zip.ZipFile
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.robolectric.RuntimeEnvironment

/** A real backup file made, read back and restored — the zipping, not just the format. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BackupsTest {
    private val context = RuntimeEnvironment.getApplication()
    private val william = StoryRows.parse(File("../engine/src/test/resources/golden/william.rows.json").readText())

    @Test
    fun `back up, restore beside the original, and every take comes with it`() {
        val take = File(context.filesDir, "audio/${william.story.id}/START-1.wav").apply { parentFile!!.mkdirs(); writeBytes(ByteArray(1600) { (it % 251).toByte() }) }
        val gone = File(context.filesDir, "audio/${william.story.id}/lost.wav") // never written: missing on purpose
        var r = StoryEditor.setSceneTake(william, william.nodes[0].id, take.absolutePath, 100)
        r = StoryEditor.setSceneTake(r, william.nodes[1].id, gone.absolutePath, 100)

        val zip = Backups.make(context, r)
        ZipFile(zip).use { z ->
            val names = z.entries().toList().map { e -> e.name }.toSet()
            assertEquals(setOf("backup.json", "rows.json", "takes/START-1.wav"), names)
        }
        assertTrue(Backups.lastBackup(context, r.story.id) > 0)

        val opened = Backups.open(context, Uri.fromFile(zip))
        assertEquals(1, opened.manifest.takes)
        assertEquals(1, opened.manifest.missingTakes)
        val copy = Backups.restore(context, opened, asCopy = true)
        assertNotEquals(r.story.id, copy.story.id)
        val restored = File(copy.nodes[0].audioPath!!)
        assertTrue(restored.path, restored.exists() && restored.absolutePath.contains(copy.story.id))
        assertArrayEquals(take.readBytes(), restored.readBytes())
        assertEquals(r.nodes.drop(2), copy.nodes.drop(2))
    }

    @Test
    fun `a zip that isn't a backup is refused`() {
        val bad = File(context.cacheDir, "not-a-backup.zip")
        java.util.zip.ZipOutputStream(bad.outputStream()).use { z -> z.putNextEntry(java.util.zip.ZipEntry("hello.txt")); z.write("hi".toByteArray()); z.closeEntry() }
        val e = assertThrows(IllegalStateException::class.java) { Backups.open(context, Uri.fromFile(bad)) }
        assertTrue("isn't a Jackie Dungeon backup" in (e.message ?: ""))
    }
}
