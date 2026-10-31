package com.jackie.dungeon.story

import com.jackie.dungeon.engine.StoryPack
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The phone builds packs itself now, from the rows it edits. These tests hold
 * that to the web app: the same rows must give the same pack, and the same
 * script must split into the same lines.
 */
class PackBuilderTest {
    private fun res(name: String) = javaClass.getResource("/golden/$name")!!.readText()

    /** Absent and null mean the same thing on both sides of the port. */
    private fun norm(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.filterValues { it !is JsonNull }.mapValues { norm(it.value) })
        is JsonArray -> JsonArray(e.map(::norm))
        else -> e
    }

    @TestFactory
    fun packs(): List<DynamicTest> = listOf("demo", "kitchen", "william", "jcfc").map { name ->
        DynamicTest.dynamicTest(name) {
            val rows = StoryRows.parse(res("$name.rows.json"))
            val built = StoryPack.json.encodeToJsonElement(StoryPack.serializer(), PackBuilder.build(rows))
            val expected = Json.parseToJsonElement(res("$name.pack.json"))
            val e = norm(expected).jsonObject
            val b = norm(built).jsonObject
            // Field by field first, so a failure names the room or door that differs.
            for (key in listOf("nodes", "choices", "vars")) {
                val ea = e[key]!!.jsonArray; val ba = b[key]!!.jsonArray
                assertEquals(ea.size, ba.size, "$name: $key count")
                ea.zip(ba).forEachIndexed { i, (x, y) -> assertEquals(x, y, "$name: $key[$i] ${x.jsonObject["id"] ?: x.jsonObject["slug"]}") }
            }
            assertEquals(e, b, "$name: whole pack")
        }
    }

    @Test
    fun `splits every script exactly as the web app does`() {
        val cases = Json.parseToJsonElement(res("splits.json")).jsonArray
        for (c in cases) {
            val text = c.jsonObject["text"]!!.jsonPrimitive.content
            val expected = c.jsonObject["lines"]!!.jsonArray.map {
                val o = it.jsonObject
                Dialogue.Spoken(o["speaker"]?.takeIf { s -> s !is JsonNull }?.jsonPrimitive?.content, o["text"]!!.jsonPrimitive.content)
            }
            assertEquals(expected, Dialogue.split(text), "split of: $text")
        }
    }

    @Test
    fun `rows survive a save and a load unchanged`() {
        for (name in listOf("demo", "kitchen", "william", "jcfc")) {
            val rows = StoryRows.parse(res("$name.rows.json"))
            assertEquals(rows, StoryRows.parse(rows.encode()), name)
        }
    }
}
