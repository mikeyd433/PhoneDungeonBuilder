package com.jackie.dungeon.story

import com.jackie.dungeon.engine.Expression
import com.jackie.dungeon.engine.ExpressionSerializer
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy

/**
 * A whole story, as table rows — the same shape as the Supabase tables
 * (src/types/domain.ts mirrors the migrations; this mirrors that), so a story
 * copied from the database loads as-is and sync can be added later without a
 * second model.
 *
 * This is what the phone EDITS. What it PLAYS is a [com.jackie.dungeon.engine.StoryPack],
 * built from these rows by [PackBuilder] exactly as the web app builds one.
 *
 * Order matters: rows are kept in the order they were created, because item
 * bit positions and tie-breaks follow it.
 */
@Serializable
data class StoryRows(
    val story: StoryRow,
    val nodes: List<NodeRow> = emptyList(),
    val choices: List<ChoiceRow> = emptyList(),
    val stateVars: List<StateVarRow> = emptyList(),
    val effects: List<EffectRow> = emptyList(),
    val gates: List<GateRow> = emptyList(),
    val characters: List<CharacterRow> = emptyList(),
    val dialogueLines: List<LineRow> = emptyList(),
    val fights: List<FightRow> = emptyList(),
    val fightMoves: List<FightMoveRow> = emptyList(),
    val fightRounds: List<FightRoundRow> = emptyList(),
    val fightRoundOutcomes: List<FightOutcomeRow> = emptyList(),
) {
    companion object {
        @OptIn(ExperimentalSerializationApi::class)
        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
            namingStrategy = JsonNamingStrategy.SnakeCase
        }

        fun parse(text: String): StoryRows = json.decodeFromString(serializer(), text)
    }

    fun encode(): String = json.encodeToString(serializer(), this)
}

@Serializable
data class StoryRow(
    val id: String,
    val title: String = "",
    val rootNodeId: String? = null,
    val counterClamp: Int = 10,
    val defaultFailBehavior: String = "refuse",
    val inventoryKey: String? = null,
    val inventoryIntroAudioPath: String? = null,
    val inventoryEmptyAudioPath: String? = null,
    /** Phone-only: how far each chapter's lane was moved by hand on the flowchart, [dx, dy]. */
    val laneNudges: Map<String, List<Float>> = emptyMap(),
)

@Serializable
data class NodeRow(
    val id: String,
    val slug: String,
    val title: String = "",
    val narration: String = "",
    val nodeType: String = "room",
    val endingKind: String? = null,
    val audioPath: String? = null,
    val audioDurationMs: Int? = null,
    val status: String? = null,
    val notes: String? = null,
    val timeoutTargetId: String? = null,
    val invalidTargetId: String? = null,
    val timeoutSeconds: Int = 5,
    /** Phone-only so far: the flowchart's chapter. Not a Supabase column yet. */
    val chapter: String? = null,
    /** Phone-only: how far this box was moved by hand from where the layout put it. */
    val nudgeX: Float = 0f,
    val nudgeY: Float = 0f,
)

@Serializable
data class ChoiceRow(
    val id: String,
    val fromNodeId: String,
    val digit: String,
    val label: String = "",
    val toNodeId: String? = null,
    val reactionNarration: String? = null,
    val audioPath: String? = null,
    val audioDurationMs: Int? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class StateVarRow(
    val id: String,
    val slug: String,
    val name: String = "",
    val kind: String = "item",
    val description: String? = null,
    val isConsumable: Boolean = false,
    val audioPath: String? = null,
    val gainNarration: String? = null,
    val gainAudioPath: String? = null,
    val spendNarration: String? = null,
    val spendAudioPath: String? = null,
)

@Serializable
data class EffectRow(
    val id: String,
    val nodeId: String? = null,
    val choiceId: String? = null,
    val stateVarId: String,
    val operation: String,
    val amount: Int? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class GateRow(
    val id: String,
    val choiceId: String,
    @Serializable(with = ExpressionSerializer::class) val expression: Expression,
    val failBehavior: String = "refuse",
    val failNarration: String? = null,
    val failAudioPath: String? = null,
    val failNodeId: String? = null,
    val consumeOnPass: Boolean = false,
)

@Serializable
data class CharacterRow(
    val id: String,
    val slug: String = "",
    val name: String,
    val isPlayable: Boolean = false,
    val voiceActor: String? = null,
)

@Serializable
data class LineRow(
    val id: String,
    val nodeId: String? = null,
    val choiceId: String? = null,
    val characterId: String? = null,
    val text: String = "",
    val sortOrder: Int = 0,
    val audioPath: String? = null,
    val audioDurationMs: Int? = null,
)

@Serializable
data class FightRow(
    val id: String,
    val nodeId: String,
    val opponentName: String = "",
    val winNodeId: String? = null,
    val loseNodeId: String? = null,
    val silencePatience: Int = 3,
)

@Serializable
data class FightMoveRow(
    val id: String,
    val fightId: String,
    val slug: String,
    val label: String = "",
    val beats: String? = null,
    val sortOrder: Int = 0,
)

@Serializable
data class FightRoundRow(
    val id: String,
    val fightId: String,
    val sortOrder: Int = 0,
    val opponentMove: String = "",
    val narration: String = "",
    val audioPath: String? = null,
)

@Serializable
data class FightOutcomeRow(
    val id: String,
    val fightId: String,
    val roundId: String,
    val moveId: String,
    val toNodeId: String? = null,
)
