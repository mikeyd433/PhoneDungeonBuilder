package com.jackie.dungeon.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import kotlin.test.assertEquals
import kotlin.test.fail

/**
 * Replays sessions recorded from the TypeScript `PlaytestEngine`
 * (src/features/pack/golden.test.ts) and demands the same result, turn by turn:
 * the same parts heard, in the same order, with the same words, and the same
 * state left behind.
 *
 * When this fails after a TypeScript change, the TS engine moved and this port
 * has not followed. Port the change — don't regenerate around it.
 */
class GoldenSessionsTest {

    private fun resource(name: String): String =
        javaClass.getResource("/golden/$name")?.readText() ?: fail("missing golden/$name — run JD_UPDATE_GOLDEN=1 pnpm test golden")

    @TestFactory
    fun sessions(): List<DynamicTest> = listOf("demo", "kitchen", "william", "jcfc").flatMap { name ->
        val pack = StoryPack.parse(resource("$name.pack.json"))
        val sessions = Json.parseToJsonElement(resource("$name.sessions.json")).jsonArray
        sessions.map { session ->
            val seed = session.jsonObject["seed"]!!.jsonPrimitive.int
            DynamicTest.dynamicTest("$name seed $seed") { replay(pack, session.jsonObject["steps"]!!.jsonArray) }
        }
    }

    private fun replay(pack: StoryPack, steps: JsonArray) {
        val engine = Engine(pack)
        var state: State? = null
        steps.forEachIndexed { i, el ->
            val step = el.jsonObject
            val key = step["key"]!!.jsonPrimitive.content
            val heard: List<Part>
            if (key == "START") {
                state = engine.start()
                heard = engine.arrival(state!!)
            } else {
                val turn = if (key == "T") engine.timeout(state!!) else engine.press(state!!, key)
                state = turn.next
                heard = turn.heard
            }
            val where = "step $i (key $key)"
            assertEquals(expectedHeard(step["heard"]!!.jsonArray), heard, "$where: heard")
            assertEquals(step["state"]!!.jsonObject, stateJson(state!!), "$where: state")
            step["held"]?.let { held ->
                assertEquals(held.jsonArray.map { it.jsonPrimitive.content }, engine.held(state!!), "$where: held")
            }
        }
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    private fun expectedHeard(a: JsonArray) = a.map {
        val o = it.jsonObject
        Part(str(o["id"])!!, str(o["audio"]), str(o["say"]) ?: "", str(o["speaker"]))
    }

    private fun stateJson(s: State) = JsonObject(
        linkedMapOf(
            "node" to JsonPrimitive(s.nodeId),
            "mask" to JsonPrimitive(s.caller.mask),
            "counters" to JsonArray(s.caller.counters.map { JsonPrimitive(it) }),
            "path" to JsonPrimitive(s.path.joinToString(" ")),
            "failed" to JsonPrimitive(s.failedAttempts),
            "finished" to JsonPrimitive(s.finished),
            "round" to (s.fightRound?.let { JsonPrimitive(it) } ?: JsonNull),
            "silences" to JsonPrimitive(s.fightSilences),
        ),
    )

}
