package com.jackie.dungeon.engine

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * A story pack, as written by `src/features/pack/storyPack.ts`.
 *
 * Field names and meanings mirror that file exactly; read its header for why
 * the line between "what is heard" (precomputed there) and "what happens"
 * (decided here, by [Engine]) sits where it does.
 */
@Serializable
data class StoryPack(
    val format: String,
    val version: Int,
    val title: String,
    val root: String? = null,
    val counterClamp: Int = 10,
    val inventoryKey: String? = null,
    val inventoryIntroAudio: String? = null,
    val inventoryEmptyAudio: String? = null,
    val vars: List<PackVar> = emptyList(),
    val nodes: List<PackNode> = emptyList(),
    val choices: List<PackChoice> = emptyList(),
) {
    companion object {
        const val FORMAT = "jackie-story-pack"
        const val VERSION = 1
        val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

        /** Parses a pack, refusing anything that isn't one — a story is not
         *  worth guessing at when the alternative is a clear message. */
        fun parse(text: String): StoryPack {
            val pack = json.decodeFromString(serializer(), text)
            require(pack.format == FORMAT) { "Not a Jackie Dungeon story pack." }
            require(pack.version <= VERSION) {
                "This story pack is from a newer version of Jackie Dungeon. Update the app."
            }
            return pack
        }
    }
}

/** Something the caller hears: a take, or words with no take behind them. */
@Serializable
data class Part(val id: String, val audio: String? = null, val say: String = "", val speaker: String? = null)

@Serializable
data class PackEffect(val `var`: String, val op: String, val amount: Int? = null)

@Serializable
data class PackVar(
    val slug: String,
    val name: String = "",
    val kind: String,
    val consumable: Boolean = false,
    val nameAudio: String? = null,
    val gain: Part? = null,
    val spend: Part? = null,
)

@Serializable
data class PackGate(
    @Serializable(with = ExpressionSerializer::class) val expression: Expression,
    val fail: String,
    val failNarration: String? = null,
    val failAudio: String? = null,
    val failNode: String? = null,
    val consumeOnPass: Boolean = false,
)

@Serializable
data class PackChoice(
    val id: String,
    val from: String,
    val digit: String,
    val label: String = "",
    val to: String? = null,
    val sortOrder: Int = 0,
    val effects: List<PackEffect> = emptyList(),
    val reaction: List<Part> = emptyList(),
    val gate: PackGate? = null,
)

@Serializable
data class FightMove(val id: String, val slug: String, val label: String = "", val beats: String? = null)

@Serializable
data class FightRound(val id: String, val opponentMove: String = "", val narration: String = "", val audio: String? = null)

@Serializable
data class FightOutcome(val round: String, val move: String, val to: String? = null)

@Serializable
data class PackFight(
    val id: String,
    val opponent: String,
    val win: String? = null,
    val lose: String? = null,
    val patience: Int = 3,
    val moves: List<FightMove> = emptyList(),
    val rounds: List<FightRound> = emptyList(),
    val outcomes: List<FightOutcome> = emptyList(),
)

@Serializable
data class PackNode(
    val id: String,
    val slug: String,
    val title: String = "",
    val ending: Boolean = false,
    val endingKind: String? = null,
    val invalidTarget: String? = null,
    val timeoutTarget: String? = null,
    val timeoutSeconds: Int = 8,
    val playback: List<Part> = emptyList(),
    val effects: List<PackEffect> = emptyList(),
    val fight: PackFight? = null,
)

/** A gate's condition — `GateExpression` in src/types/domain.ts. */
sealed interface Expression {
    data class Has(val v: String) : Expression
    data class Lacks(val v: String) : Expression
    data class Gte(val v: String, val value: Int) : Expression
    data class Lte(val v: String, val value: Int) : Expression
    data class Eq(val v: String, val value: Int) : Expression
    data class And(val args: List<Expression>) : Expression
    data class Or(val args: List<Expression>) : Expression
    data class Not(val arg: Expression?) : Expression
    /** An op this build doesn't know. Evaluates true, as the TS `default` does. */
    data class Unknown(val op: String) : Expression

    companion object {
        fun from(el: JsonElement): Expression {
            val o = el.jsonObject
            val op = o["op"]?.jsonPrimitive?.content ?: ""
            fun v() = o["var"]?.jsonPrimitive?.content ?: ""
            fun n() = o["value"]?.jsonPrimitive?.int ?: 0
            fun args() = (o["args"] as? JsonArray)?.map(::from) ?: emptyList()
            return when (op) {
                "has" -> Has(v())
                "lacks" -> Lacks(v())
                "gte" -> Gte(v(), n())
                "lte" -> Lte(v(), n())
                "eq" -> Eq(v(), n())
                "and" -> And(args())
                "or" -> Or(args())
                "not" -> Not(args().firstOrNull())
                else -> Unknown(op)
            }
        }

        fun toJson(e: Expression): JsonElement = when (e) {
            is Has -> buildJsonObject { put("op", "has"); put("var", e.v) }
            is Lacks -> buildJsonObject { put("op", "lacks"); put("var", e.v) }
            is Gte -> buildJsonObject { put("op", "gte"); put("var", e.v); put("value", e.value) }
            is Lte -> buildJsonObject { put("op", "lte"); put("var", e.v); put("value", e.value) }
            is Eq -> buildJsonObject { put("op", "eq"); put("var", e.v); put("value", e.value) }
            is And -> JsonObject(mapOf("op" to JsonPrimitive("and"), "args" to JsonArray(e.args.map(::toJson))))
            is Or -> JsonObject(mapOf("op" to JsonPrimitive("or"), "args" to JsonArray(e.args.map(::toJson))))
            is Not -> JsonObject(mapOf("op" to JsonPrimitive("not"), "args" to JsonArray(listOfNotNull(e.arg?.let(::toJson)))))
            is Unknown -> buildJsonObject { put("op", e.op) }
        }
    }
}

object ExpressionSerializer : KSerializer<Expression> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor
    override fun deserialize(decoder: Decoder): Expression =
        Expression.from((decoder as JsonDecoder).decodeJsonElement())
    override fun serialize(encoder: Encoder, value: Expression) =
        (encoder as JsonEncoder).encodeJsonElement(Expression.toJson(value))
}
