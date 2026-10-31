package com.jackie.dungeon.export

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.evaluate
import com.jackie.dungeon.story.StoryEditor
import com.jackie.dungeon.story.StoryRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The phone's Twilio export is the web app's exporter, bundled and run in
 * QuickJS. These tests run that exact bundle in QuickJS on the JVM, on the
 * phone's own copy of each story (rows as the phone saves them), and require
 * the web app's output — so a field the phone fails to keep, or a stale
 * bundle, shows up here rather than as "Something went wrong" in Studio.
 */
class TwilioExportTest {
    private val bundle = File("../app/src/main/assets/js/exporter.js").readText()
    private fun res(name: String) = javaClass.getResource("/golden/$name")!!.readText()

    private val quickJs = TwilioExport.Js { code ->
        runBlocking { QuickJs.create(Dispatchers.Default).use { it.evaluate<String>(code) } }
    }

    @TestFactory
    fun `the phone exports exactly what the web app exports`(): List<DynamicTest> = listOf("demo", "kitchen", "william", "jcfc").map { name ->
        DynamicTest.dynamicTest(name) {
            val phoneRows = StoryRows.parse(StoryRows.parse(res("$name.rows.json")).encode())
            val got = TwilioExport.run(quickJs, bundle, phoneRows)
            val want = TwilioExport.parse(res("$name.export.json").trim())
            assertEquals(Json.parseToJsonElement(want.flow), Json.parseToJsonElement(got.flow), "$name: flow")
            assertEquals(want.warnings, got.warnings, "$name: warnings")
            assertEquals(want.sheet, got.sheet, "$name: build sheet")
            assertEquals(want.widgets, got.widgets)
        }
    }

    @Test
    fun `takes recorded on the phone point at the upload address, and only they are collected`() {
        var r = StoryEditor.newStory("Takes")
        val start = r.story.rootNodeId!!
        r = StoryEditor.setScript(r, start, "Hello.")
        r = StoryEditor.setSceneTake(r, start, "/data/user/0/com.jackie.dungeon/files/audio/x/START-1.wav", 900)
        val (a, door) = StoryEditor.addChoice(r, start, "On", newScene = true); r = a
        r = StoryEditor.setReply(r, door, "Off we go.")
        r = StoryEditor.setReplyTake(r, door, "story/old-take.wav", 500) // came from Supabase
        val p = TwilioExport.prepare(r, "https://jackie-1234.twil.io/", "https://sb.example/story-audio")
        assertEquals(mapOf("/data/user/0/com.jackie.dungeon/files/audio/x/START-1.wav" to "START-1.wav"), p.files)

        val out = TwilioExport.run(quickJs, bundle, p.rows, TwilioExport.positions(p.rows))
        val plays = Json.parseToJsonElement(out.flow).jsonObject["states"]!!.jsonArray
            .mapNotNull { it.jsonObject["properties"]!!.jsonObject["play"]?.jsonPrimitive?.content }
        assertTrue("https://jackie-1234.twil.io/START-1.wav" in plays, plays.toString())
        assertTrue("https://sb.example/story-audio/story/old-take.wav" in plays, plays.toString())
        assertTrue(out.widgets in 1..out.limit)
        assertTrue(TwilioExport.readme("Takes", "https://jackie-1234.twil.io", out, p.files).contains("Import from JSON"))
    }
}
