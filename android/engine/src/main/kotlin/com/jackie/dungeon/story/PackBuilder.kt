package com.jackie.dungeon.story

import com.jackie.dungeon.engine.FightMove
import com.jackie.dungeon.engine.FightOutcome
import com.jackie.dungeon.engine.FightRound
import com.jackie.dungeon.engine.PackChoice
import com.jackie.dungeon.engine.PackEffect
import com.jackie.dungeon.engine.PackFight
import com.jackie.dungeon.engine.PackGate
import com.jackie.dungeon.engine.PackNode
import com.jackie.dungeon.engine.PackVar
import com.jackie.dungeon.engine.Part
import com.jackie.dungeon.engine.StoryPack

/**
 * Port of `buildStoryPack` (src/features/pack/storyPack.ts): the rows the phone
 * edits, turned into the pack the engine plays. `PackBuilderTest` builds a pack
 * from each fixture's rows and requires it to equal the one the web app built.
 */
object PackBuilder {

    fun build(rows: StoryRows, resolve: (String) -> String = { it }): StoryPack {
        fun url(path: String?) = if (path.isNullOrEmpty()) null else resolve(path)
        fun part(p: Part) = p.copy(audio = url(p.audio))

        val slugOf = rows.stateVars.associate { it.id to it.slug }
        fun effectsWhere(pred: (EffectRow) -> Boolean) = rows.effects.filter(pred)
            .sortedBy { it.sortOrder }
            .map { PackEffect(slugOf[it.stateVarId] ?: "", it.operation, it.amount) }
            .filter { it.`var`.isNotEmpty() }

        val vars = rows.stateVars.map { v ->
            PackVar(v.slug, v.name, v.kind, v.isConsumable, url(v.audioPath), Dialogue.clipFor(v, true)?.let(::part), Dialogue.clipFor(v, false)?.let(::part))
        }

        fun fightAt(nodeId: String): PackFight? {
            val f = rows.fights.firstOrNull { it.nodeId == nodeId } ?: return null
            val moves = rows.fightMoves.filter { it.fightId == f.id }
                .sortedWith { a, b -> if (a.sortOrder != b.sortOrder) a.sortOrder - b.sortOrder else a.slug.compareTo(b.slug) }
            val rounds = rows.fightRounds.filter { it.fightId == f.id }.sortedBy { it.sortOrder }
            // A JS Map keeps a key where it was first set and takes the last value.
            val outcomes = LinkedHashMap<String, FightOutcomeRow>()
            rows.fightRoundOutcomes.filter { it.fightId == f.id }.forEach { outcomes["${it.roundId}:${it.moveId}"] = it }
            return PackFight(
                id = f.id,
                opponent = f.opponentName,
                win = f.winNodeId,
                lose = f.loseNodeId,
                patience = f.silencePatience,
                moves = moves.map { FightMove(it.id, it.slug, it.label, it.beats) },
                rounds = rounds.map { FightRound(it.id, it.opponentMove, it.narration, url(it.audioPath)) },
                outcomes = outcomes.values.map { FightOutcome(it.roundId, it.moveId, it.toNodeId) },
            )
        }

        val nodes = rows.nodes.map { n ->
            val ending = n.nodeType == "ending"
            PackNode(
                id = n.id, slug = n.slug, title = n.title, ending = ending,
                endingKind = if (ending) (n.endingKind ?: "death") else null,
                invalidTarget = n.invalidTargetId, timeoutTarget = n.timeoutTargetId, timeoutSeconds = n.timeoutSeconds,
                playback = Dialogue.playbackFor(rows, n).map(::part),
                effects = effectsWhere { it.nodeId == n.id },
                fight = fightAt(n.id),
            )
        }

        val choices = rows.choices.map { c ->
            val g = rows.gates.firstOrNull { it.choiceId == c.id }
            PackChoice(
                id = c.id, from = c.fromNodeId, digit = c.digit, label = c.label, to = c.toNodeId, sortOrder = c.sortOrder,
                effects = effectsWhere { it.choiceId == c.id },
                reaction = Dialogue.reactionPlaybackFor(rows, c).map(::part),
                gate = g?.let { PackGate(it.expression, it.failBehavior, it.failNarration, url(it.failAudioPath), it.failNodeId, it.consumeOnPass) },
            )
        }

        return StoryPack(
            format = StoryPack.FORMAT,
            version = StoryPack.VERSION,
            title = rows.story.title,
            root = rows.story.rootNodeId,
            counterClamp = rows.story.counterClamp,
            inventoryKey = rows.story.inventoryKey,
            inventoryIntroAudio = url(rows.story.inventoryIntroAudioPath),
            inventoryEmptyAudio = url(rows.story.inventoryEmptyAudioPath),
            vars = vars, nodes = nodes, choices = choices,
        )
    }
}
