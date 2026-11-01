package com.jackie.dungeon.export

import com.jackie.dungeon.story.FlowLayout
import com.jackie.dungeon.story.StoryRows
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/**
 * The Twilio export, phone side.
 *
 * There is ONE exporter: src/features/export/phoneExport.ts, bundled into the
 * app as assets/js/exporter.js and run in a JavaScript engine ([Js]). This file
 * only does what the web app never had to: decide where each take recorded on
 * the phone will live once uploaded, collect those files, and lay the flow out
 * like the phone's flowchart.
 *
 * Nothing here talks to Twilio. The result is files the author imports
 * (Studio → Import from JSON) and uploads (an Assets service, or anywhere public).
 */
object TwilioExport {

    /** Runs the bundled exporter. QuickJS on the phone and in the JVM tests. */
    fun interface Js {
        fun eval(code: String): String
    }

    data class Prepared(
        /** The rows with every take pointing at its final, public address. */
        val rows: StoryRows,
        /** Local file path -> the name it is uploaded under. */
        val files: Map<String, String>,
    )

    data class Result(
        val flow: String,
        val sheet: String,
        val manifest: String,
        val script: String,
        val warnings: List<String>,
        val widgets: Int,
        val limit: Int,
    )

    /**
     * Point every take at where it will be: a file recorded on this phone at
     * `[audioBase]/<its file name>`, a take that came from Supabase at its
     * public link there. Paths that are already links are left alone.
     */
    fun prepare(rows: StoryRows, audioBase: String, supabaseBase: String): Prepared {
        val files = LinkedHashMap<String, String>()
        val base = audioBase.trim().trimEnd('/')
        fun url(path: String?): String? = when {
            path.isNullOrEmpty() -> path
            path.startsWith("http://") || path.startsWith("https://") -> path
            path.startsWith("/") -> {
                val name = files.getOrPut(path) { uniqueName(path.substringAfterLast('/'), files.values) }
                "$base/$name"
            }
            else -> supabaseBase.trimEnd('/') + "/" + path
        }
        val r = rows.mapAudio { url(it) }
        return Prepared(r, files)
    }

    private fun uniqueName(name: String, taken: Collection<String>): String {
        if (name !in taken) return name
        val stem = name.substringBeforeLast('.'); val ext = name.substringAfterLast('.', "wav")
        var n = 2
        while ("$stem-$n.$ext" in taken) n++
        return "$stem-$n.$ext"
    }

    /** Studio canvas positions from the phone's flowchart, so the imported flow reads the same way. */
    fun positions(rows: StoryRows): String {
        val layout = FlowLayout.layout(rows)
        return buildJsonObject {
            for (b in layout.boxes.values) putJsonObject(b.id) {
                put("x", ((b.x - layout.minX) * 2.2f).toInt())
                put("y", (b.y * 2.6f).toInt())
            }
        }.toString()
    }

    /** Run the bundled exporter on [rows]. [bundle] is assets/js/exporter.js. */
    fun run(js: Js, bundle: String, rows: StoryRows, positionsJson: String = "{}"): Result {
        val call = "\n;JackieExport.exportForTwilio(" + JsonPrimitive(rows.encode()) + "," + JsonPrimitive(positionsJson) + ")"
        return parse(js.eval(bundle + call))
    }

    fun parse(json: String): Result {
        val o = Json.parseToJsonElement(json).jsonObject
        fun str(k: String) = o[k]!!.jsonPrimitive.content
        return Result(
            flow = str("flow"), sheet = str("sheet"), manifest = str("manifest"), script = str("script"),
            warnings = o["warnings"]!!.jsonArray.map { it.jsonPrimitive.content },
            widgets = o["widgets"]!!.jsonPrimitive.int, limit = o["limit"]!!.jsonPrimitive.int,
        )
    }

    /** What goes in the zip next to the flow: the steps, and what will be silent. */
    fun readme(title: String, audioBase: String, result: Result, files: Map<String, String>): String = buildString {
        appendLine("JACKIE DUNGEON: $title, for Twilio Studio")
        appendLine()
        appendLine("1. Upload the audio")
        if (files.isEmpty()) appendLine("   This story has no recordings on the phone, so there is nothing to upload.")
        else {
            appendLine("   Upload every file in audio/ (${files.size}) so each is public at:")
            appendLine("     ${audioBase.trimEnd('/')}/<file name>")
            appendLine("   With Twilio Assets: Console > Functions and Assets > Services > your service >")
            appendLine("   Add > Upload File (set each to Public), then Deploy All.")
        }
        appendLine()
        appendLine("2. Import the flow")
        appendLine("   Console > Studio > Flows > + (Create new flow) > Import from JSON,")
        appendLine("   paste the contents of flow.json, then Publish.")
        appendLine()
        appendLine("3. Connect a number")
        appendLine("   Phone Numbers > your number > A call comes in: Studio Flow > this flow.")
        appendLine()
        appendLine("Size: ${result.widgets} of Twilio's ${result.limit} widgets.")
        appendLine()
        if (result.warnings.isEmpty()) appendLine("Nothing will be silent on the phone.")
        else {
            appendLine("WILL BE SILENT OR BROKEN ON THE PHONE (${result.warnings.size}):")
            result.warnings.forEach { appendLine("  - $it") }
        }
        appendLine()
        appendLine("Also here: build-sheet.txt (the same flow as a step-by-step list), audio-manifest.csv")
        appendLine("(every recordable line and what to call its file) and script.txt (for the actors).")
    }
}
