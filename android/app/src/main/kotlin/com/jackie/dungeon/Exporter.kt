package com.jackie.dungeon

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.evaluate
import com.jackie.dungeon.export.TwilioExport
import com.jackie.dungeon.story.StoryRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Builds the Twilio export zip on the phone and hands it to the share sheet.
 * The flow itself comes from the web app's exporter, run in QuickJS — see
 * [TwilioExport] for why there is only one.
 */
object Exporter {
    private const val PREFS = "export"
    private const val SUPABASE_AUDIO = "https://tzfkylvtndgaugbgxbuc.supabase.co/storage/v1/object/public/story-audio"

    data class Done(val zip: File, val result: TwilioExport.Result, val files: Int)

    fun audioBase(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("audioBase", "") ?: ""

    fun setAudioBase(context: Context, value: String) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("audioBase", value.trim()).apply()

    /** Slow (it compiles the whole story): call off the main thread. */
    fun export(context: Context, rows: StoryRows, audioBase: String): Done {
        val bundle = context.assets.open("js/exporter.js").bufferedReader().use { it.readText() }
        val prepared = TwilioExport.prepare(rows, audioBase, SUPABASE_AUDIO)
        val js = TwilioExport.Js { code -> runBlocking { QuickJs.create(Dispatchers.Default).use { it.evaluate<String>(code) } } }
        val result = TwilioExport.run(js, bundle, prepared.rows, TwilioExport.positions(prepared.rows))

        val dir = File(context.cacheDir, "exports").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
        val name = rows.story.title.ifBlank { "story" }.replace(Regex("[^A-Za-z0-9]+"), "-").trim('-').lowercase().ifEmpty { "story" }
        val zip = File(dir, "$name-twilio.zip")
        ZipOutputStream(zip.outputStream()).use { z ->
            fun put(path: String, bytes: ByteArray) { z.putNextEntry(ZipEntry(path)); z.write(bytes); z.closeEntry() }
            put("README.txt", TwilioExport.readme(rows.story.title, audioBase, result, prepared.files).toByteArray())
            put("flow.json", result.flow.toByteArray())
            put("build-sheet.txt", result.sheet.toByteArray())
            put("audio-manifest.csv", result.manifest.toByteArray())
            put("script.txt", result.script.toByteArray())
            for ((local, upload) in prepared.files) {
                val f = File(local)
                if (f.exists()) put("audio/$upload", f.readBytes())
            }
        }
        return Done(zip, result, prepared.files.size)
    }

    fun share(context: Context, zip: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", zip)
        val send = Intent(Intent.ACTION_SEND)
            .setType("application/zip")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, zip.nameWithoutExtension)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, "Send the Twilio export").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
