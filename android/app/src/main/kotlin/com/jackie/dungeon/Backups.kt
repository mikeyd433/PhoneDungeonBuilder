package com.jackie.dungeon

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.jackie.dungeon.story.Backup
import com.jackie.dungeon.story.StoryRows
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Backing a story up to one file, and restoring it — so a story isn't lost
 * with the phone. The file goes wherever the share sheet sends it (Drive,
 * email, Files); restoring picks it back up from anywhere the file picker can
 * reach. The format is [Backup]'s; this only zips, unzips and files things.
 */
object Backups {
    private const val PREFS = "backups"

    /** Make the backup file for one story. Off the main thread: it copies every take. */
    fun make(context: Context, rows: StoryRows): File {
        val packed = Backup.pack(rows)
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val out = File(dir, Backup.fileName(rows.story.title, day))
        var missing = 0
        ZipOutputStream(out.outputStream()).use { z ->
            fun put(path: String, bytes: ByteArray) { z.putNextEntry(ZipEntry(path)); z.write(bytes); z.closeEntry() }
            val takes = packed.files.filter { (local, _) -> File(local).exists().also { if (!it) missing++ } }
            val manifest = Backup.Manifest(
                title = rows.story.title, storyId = rows.story.id,
                savedAt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()),
                scenes = rows.nodes.size, takes = takes.size, missingTakes = missing,
            )
            put("backup.json", Backup.json.encodeToString(Backup.Manifest.serializer(), manifest).toByteArray())
            put("rows.json", packed.rows.encode().toByteArray())
            for ((local, name) in takes) {
                z.putNextEntry(ZipEntry(Backup.TAKES + name))
                File(local).inputStream().use { it.copyTo(z) }
                z.closeEntry()
            }
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(rows.story.id, System.currentTimeMillis()).apply()
        return out
    }

    /** The story got a new id (its first sync): keep its "last backed up". */
    fun rekey(context: Context, from: String, to: String) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val at = p.getLong(from, 0L)
        if (at != 0L) p.edit().putLong(to, at).remove(from).apply()
    }

        /** When this story was last backed up, or 0 for never. */
    fun lastBackup(context: Context, storyId: String): Long =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(storyId, 0L)

    fun share(context: Context, files: List<File>) {
        val uris = ArrayList(files.map { FileProvider.getUriForFile(context, "${context.packageName}.files", it) })
        val send = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
        else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        send.setType("application/zip")
            .putExtra(Intent.EXTRA_SUBJECT, if (files.size == 1) files[0].nameWithoutExtension else "Jackie Dungeon backups")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, "Keep the backup somewhere safe").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** A backup read back in, its takes waiting in a scratch folder until [restore]. */
    class Opened(val manifest: Backup.Manifest, val rows: StoryRows, val takes: File)

    /** Read a backup file. Throws with a readable message if it isn't one. */
    fun open(context: Context, uri: Uri): Opened {
        val scratch = File(context.cacheDir, "restore").apply { deleteRecursively(); mkdirs() }
        var manifest: Backup.Manifest? = null
        var rows: StoryRows? = null
        val stream = context.contentResolver.openInputStream(uri) ?: error("That file couldn't be opened.")
        ZipInputStream(stream.buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val name = e.name
                when {
                    e.isDirectory -> Unit
                    name == "backup.json" -> manifest = Backup.json.decodeFromString(Backup.Manifest.serializer(), z.readBytes().decodeToString())
                    name == "rows.json" -> rows = StoryRows.parse(z.readBytes().decodeToString())
                    // Only plain file names under takes/: nothing in a zip gets to choose where it lands.
                    name.startsWith(Backup.TAKES) && name.removePrefix(Backup.TAKES).let { it.isNotEmpty() && '/' !in it && '\\' !in it && it != ".." && it != "." } ->
                        File(scratch, name.removePrefix(Backup.TAKES)).outputStream().use { z.copyTo(it) }
                    else -> Unit
                }
            }
        }
        val m = manifest ?: error("That file isn't a Jackie Dungeon backup.")
        Backup.check(m)
        return Opened(m, rows ?: error("That backup has no story in it."), scratch)
    }

    /**
     * Put a backup on the phone: its takes into the story's audio folder and the
     * story into the library. [asCopy] keeps the one already here and adds this
     * beside it; otherwise a story with the same id is replaced.
     */
    fun restore(context: Context, o: Opened, asCopy: Boolean): StoryRows {
        val rows = if (asCopy) Backup.asCopy(o.rows) else o.rows
        val dir = File(context.filesDir, "audio/${rows.story.id}").apply { mkdirs() }
        val restored = Backup.unpack(rows) { name ->
            val from = File(o.takes, name)
            val to = File(dir, name)
            if (from.exists()) from.copyTo(to, overwrite = true)
            to.absolutePath
        }
        o.takes.deleteRecursively()
        return restored
    }
}
