package com.jackie.dungeon.story

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A story backed up as one file: its rows, and every take recorded on the
 * phone, so it can be kept off the phone (Drive, email) and restored on any
 * phone. Pure — the app does the zipping and the file picking.
 *
 * Inside the zip:
 *   backup.json   what this is ([Manifest])
 *   rows.json     the story, takes pointing at `takes/<name>`
 *   takes/…       the 8 kHz WAVs recorded or imported on the phone
 *
 * Takes that came from Supabase are paths in the public bucket, not files on
 * the phone; they stay as they are and still play after a restore.
 */
object Backup {
    const val FORMAT = "jackie-backup"
    const val VERSION = 1
    const val TAKES = "takes/"

    @Serializable
    data class Manifest(
        val format: String = FORMAT,
        val version: Int = VERSION,
        val title: String,
        val storyId: String,
        val savedAt: String,
        val scenes: Int,
        val takes: Int,
        val missingTakes: Int = 0,
    )

    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = true }

    data class Packed(
        val rows: StoryRows,
        /** Local file -> its name inside the zip (under [TAKES]). */
        val files: Map<String, String>,
    )

    /** A take recorded on this phone is an absolute path; everything else is a link or a bucket path. */
    fun isLocal(path: String) = path.startsWith("/")

    /** Point every local take at `takes/<name>`, each file once, names never clashing. */
    fun pack(r: StoryRows): Packed {
        val files = LinkedHashMap<String, String>()
        val rows = r.mapAudio { p ->
            if (!isLocal(p)) p
            else TAKES + files.getOrPut(p) { unique(p.substringAfterLast('/'), files.values) }
        }
        return Packed(rows, files)
    }

    /** Back from a zip: `takes/<name>` -> where [place] put that file on this phone. */
    fun unpack(r: StoryRows, place: (String) -> String): StoryRows =
        r.mapAudio { p -> if (p.startsWith(TAKES)) place(p.removePrefix(TAKES)) else p }

    /** The same story as a separate one, for restoring beside the original. */
    fun asCopy(r: StoryRows, newId: String = StoryEditor.newId()): StoryRows =
        r.copy(story = r.story.copy(id = newId, title = r.story.title.ifBlank { "Untitled story" } + " (restored)"))

    fun check(m: Manifest) {
        require(m.format == FORMAT) { "That file isn't a Jackie Dungeon backup." }
        require(m.version <= VERSION) { "That backup is from a newer version of Jackie Dungeon. Update the app first." }
    }

    /** A file name for the backup: the title, made safe, and the date. */
    fun fileName(title: String, date: String): String {
        val t = title.ifBlank { "story" }.replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').lowercase().ifEmpty { "story" }
        return "$t-backup-$date.jdbackup.zip"
    }

    private fun unique(name: String, taken: Collection<String>): String {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]+"), "_").ifEmpty { "take.wav" }
        if (safe !in taken) return safe
        val dot = safe.lastIndexOf('.').takeIf { it > 0 } ?: safe.length
        var n = 2
        while ("${safe.substring(0, dot)}-$n${safe.substring(dot)}" in taken) n++
        return "${safe.substring(0, dot)}-$n${safe.substring(dot)}"
    }
}
