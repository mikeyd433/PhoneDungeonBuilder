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

    /**
     * Every take in the story, in one place: [f] maps each audio path (and
     * only non-empty ones). The Twilio export and the backup both walk this,
     * so a new kind of take only needs adding here.
     */
    fun mapAudio(f: (String) -> String?): StoryRows {
        fun m(p: String?) = if (p.isNullOrEmpty()) p else f(p)
        return copy(
            story = story.copy(inventoryIntroAudioPath = m(story.inventoryIntroAudioPath), inventoryEmptyAudioPath = m(story.inventoryEmptyAudioPath)),
            nodes = nodes.map { it.copy(audioPath = m(it.audioPath)) },
            choices = choices.map { it.copy(audioPath = m(it.audioPath)) },
            gates = gates.map { it.copy(failAudioPath = m(it.failAudioPath)) },
            dialogueLines = dialogueLines.map { it.copy(audioPath = m(it.audioPath)) },
            stateVars = stateVars.map { it.copy(audioPath = m(it.audioPath), gainAudioPath = m(it.gainAudioPath), spendAudioPath = m(it.spendAudioPath)) },
            fightRounds = fightRounds.map { it.copy(audioPath = m(it.audioPath)) },
        )
    }

    /**
     * Rename every row id and every reference to one, through [f] — for giving
     * a story the cloud's ids. Covers every id column and the layout keys that
     * name scenes; expressions name items by slug, not id, so they are untouched.
     */
    fun mapIds(f: (String) -> String): StoryRows {
        fun m(id: String?) = id?.let(f)
        return copy(
            story = story.copy(
                id = f(story.id), rootNodeId = m(story.rootNodeId),
                layoutHome = story.layoutHome.mapKeys { (k, _) -> if (k.startsWith("chapter:")) k else f(k) },
            ),
            nodes = nodes.map { it.copy(id = f(it.id), timeoutTargetId = m(it.timeoutTargetId), invalidTargetId = m(it.invalidTargetId)) },
            choices = choices.map { it.copy(id = f(it.id), fromNodeId = f(it.fromNodeId), toNodeId = m(it.toNodeId)) },
            stateVars = stateVars.map { it.copy(id = f(it.id)) },
            effects = effects.map { it.copy(id = f(it.id), nodeId = m(it.nodeId), choiceId = m(it.choiceId), stateVarId = f(it.stateVarId)) },
            gates = gates.map { it.copy(id = f(it.id), choiceId = f(it.choiceId), failNodeId = m(it.failNodeId)) },
            characters = characters.map { it.copy(id = f(it.id)) },
            dialogueLines = dialogueLines.map { it.copy(id = f(it.id), nodeId = m(it.nodeId), choiceId = m(it.choiceId), characterId = m(it.characterId)) },
            fights = fights.map { it.copy(id = f(it.id), nodeId = f(it.nodeId), winNodeId = m(it.winNodeId), loseNodeId = m(it.loseNodeId)) },
            fightMoves = fightMoves.map { it.copy(id = f(it.id), fightId = f(it.fightId)) },
            fightRounds = fightRounds.map { it.copy(id = f(it.id), fightId = f(it.fightId)) },
            fightRoundOutcomes = fightRoundOutcomes.map { it.copy(id = f(it.id), fightId = f(it.fightId), roundId = f(it.roundId), moveId = f(it.moveId), toNodeId = m(it.toNodeId)) },
        )
    }

    /** Every row id in the story, by table name. */
    fun idsByTable(): Map<String, List<String>> = linkedMapOf(
        "stories" to listOf(story.id),
        "nodes" to nodes.map { it.id }, "choices" to choices.map { it.id }, "state_vars" to stateVars.map { it.id },
        "effects" to effects.map { it.id }, "gates" to gates.map { it.id }, "characters" to characters.map { it.id },
        "dialogue_lines" to dialogueLines.map { it.id }, "fights" to fights.map { it.id },
        "fight_moves" to fightMoves.map { it.id }, "fight_rounds" to fightRounds.map { it.id },
        "fight_round_outcomes" to fightRoundOutcomes.map { it.id },
    )

    /** Every audio path in the story, in the order [mapAudio] visits them. */
    fun audioPaths(): List<String> { val out = ArrayList<String>(); mapAudio { out += it; it }; return out }
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
    /** Phone-only: the arrangement RESET LAYOUT returns to ("<scene id>" or "chapter:<name>" -> [dx, dy]). */
    val layoutHome: Map<String, List<Float>> = emptyMap(),
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
