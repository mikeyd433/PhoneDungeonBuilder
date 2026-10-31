package com.jackie.dungeon.engine

import kotlinx.serialization.Serializable

/**
 * The story engine — a port of `PlaytestEngine` (src/features/playtest/engine.ts),
 * with its helpers from `state/expression.ts`, `state/consume.ts`,
 * `state/itemClips.ts` and `fight/model.ts`.
 *
 * A PORT, not a reinterpretation. Every branch below has a twin in the
 * TypeScript, in the same order, saying the same words — down to the
 * parenthesised notes the rehearsal reads out. `GoldenSessionsTest` replays
 * sessions recorded from the TypeScript engine and fails on any difference,
 * because a story that behaves one way in the editor and another way in the
 * car is the bug CLAUDE.md principle 9 exists to prevent.
 *
 * Immutable in and out: every call returns a new [State].
 */
class Engine(val pack: StoryPack) {

    // ---- indexes ----------------------------------------------------------

    private val nodes: Map<String, PackNode> = LinkedHashMap<String, PackNode>().apply { pack.nodes.forEach { putIfAbsent(it.id, it) } }
    private val varsBySlug: Map<String, PackVar> = LinkedHashMap<String, PackVar>().apply { pack.vars.forEach { putIfAbsent(it.slug, it) } }

    /** slug -> bit, for items and flags; slug -> slot, for counters. In pack order. */
    private val bit = LinkedHashMap<String, Int>()
    private val slot = LinkedHashMap<String, Int>()

    init {
        for (v in pack.vars) {
            if (v.kind == "counter") { if (v.slug !in slot) slot[v.slug] = slot.size }
            else if (v.slug !in bit) bit[v.slug] = bit.size
        }
    }

    fun node(id: String): PackNode? = nodes[id]

    // ---- caller state ------------------------------------------------------

    fun emptyCaller() = Caller(0, List(slot.size) { 0 })

    fun has(c: Caller, slug: String): Boolean {
        val b = bit[slug] ?: return false
        return c.mask and (1 shl b) != 0
    }

    private fun counter(c: Caller, slug: String): Int {
        val s = slot[slug] ?: return 0
        return c.counters.getOrElse(s) { 0 }
    }

    fun evaluate(e: Expression?, c: Caller): Boolean = when (e) {
        null -> true
        is Expression.Has -> has(c, e.v)
        is Expression.Lacks -> !has(c, e.v)
        is Expression.Gte -> counter(c, e.v) >= e.value
        is Expression.Lte -> counter(c, e.v) <= e.value
        is Expression.Eq -> counter(c, e.v) == e.value
        is Expression.And -> e.args.all { evaluate(it, c) }
        is Expression.Or -> e.args.any { evaluate(it, c) }
        is Expression.Not -> !evaluate(e.arg, c)
        is Expression.Unknown -> true
    }

    fun apply(c: Caller, effects: List<PackEffect>): Caller {
        var mask = c.mask
        val counters = c.counters.toMutableList()
        for (e in effects) {
            val b = bit[e.`var`]
            if (b != null) {
                if (e.op == "grant") mask = mask or (1 shl b)
                else if (e.op == "revoke") mask = mask and (1 shl b).inv()
                continue
            }
            val s = slot[e.`var`] ?: continue
            val current = counters.getOrElse(s) { 0 }
            val next = when (e.op) {
                "add" -> current + (e.amount ?: 0)
                "set" -> e.amount ?: 0
                "grant" -> current + 1
                "revoke" -> current - 1
                else -> current
            }
            // Saturating clamp — §7 and §11.5.
            counters[s] = maxOf(0, minOf(pack.counterClamp, next))
        }
        return Caller(mask, counters)
    }

    /** `consumedBy`: which items a passing gate spends. `and` spends every
     *  branch; `or` only the first that held. Deduped, in order. */
    private fun consumedBy(e: Expression?, c: Caller): List<String> {
        val out = LinkedHashSet<String>()
        fun walk(x: Expression?) {
            when (x) {
                null -> Unit
                is Expression.Has -> if (varsBySlug[x.v]?.consumable == true) out += x.v
                is Expression.And -> x.args.forEach(::walk)
                is Expression.Or -> x.args.firstOrNull { evaluate(it, c) }?.let(::walk)
                else -> Unit
            }
        }
        walk(e)
        return out.toList()
    }

    /** `clipsFor`: what items say as an effect list moves them. `set` is
     *  bookkeeping and says nothing. One moment per item per direction. */
    private fun clipsFor(effects: List<PackEffect>): List<Part> {
        val out = mutableListOf<Part>()
        val seen = HashSet<String>()
        for (e in effects) {
            val item = varsBySlug[e.`var`] ?: continue
            val gain = when (e.op) { "grant", "add" -> true; "revoke" -> false; else -> continue }
            if (!seen.add("${item.slug}:$gain")) continue
            (if (gain) item.gain else item.spend)?.let(out::add)
        }
        return out
    }

    private fun spendClips(slugs: List<String>) = slugs.mapNotNull { varsBySlug[it]?.spend }

    private fun said(id: String, text: String, speaker: String? = null) = Part(id, null, text, speaker)

    // ---- the runtime --------------------------------------------------------

    fun start(): State {
        val root = pack.root
        if (root == null || nodes[root] == null) {
            return State("", emptyCaller(), emptyList(), 0, true, null, 0)
        }
        return enter(State(root, emptyCaller(), emptyList(), 0, false, null, 0), root).next
    }

    /** The fight in this room, if any. */
    fun fightAt(state: State): PackFight? = nodes[state.nodeId]?.fight

    private fun openingRound(nodeId: String): Int? {
        val f = nodes[nodeId]?.fight ?: return null
        return if (f.rounds.isNotEmpty()) 0 else null
    }

    fun roundPrompt(state: State): String? {
        val f = fightAt(state) ?: return null
        val r = state.fightRound ?: return null
        val round = f.rounds.getOrNull(r) ?: return null
        return round.narration.ifEmpty { "${f.opponent}: ${round.opponentMove}" }
    }

    /** The moves on offer this round, in keypad order. */
    fun fightOptions(state: State): List<Offer> {
        val f = fightAt(state) ?: return emptyList()
        if (state.fightRound == null) return emptyList()
        return f.moves.take(9).mapIndexed { i, m -> Offer("${i + 1}", m.label.ifEmpty { m.slug }, open = true, choiceId = null) }
    }

    /** What the caller is offered here, in sort order. A failed `hide` is not. */
    fun offered(state: State): List<OfferedChoice> {
        if (state.fightRound != null) return emptyList()
        val out = mutableListOf<OfferedChoice>()
        for (choice in pack.choices) {
            if (choice.from != state.nodeId) continue
            val gate = choice.gate
            val open = gate?.let { evaluate(it.expression, state.caller) } ?: true
            if (gate != null && !open && gate.fail == "hide") continue
            out += OfferedChoice(choice, open)
        }
        return out.sortedBy { it.choice.sortOrder }
    }

    /** What the keypad shows: the round's moves in a fight, the doors otherwise. */
    fun keys(state: State): List<Offer> =
        if (state.fightRound != null) fightOptions(state)
        else offered(state).map { Offer(it.choice.digit, it.choice.label, it.open, it.choice.id) }

    fun press(state: State, digit: String): Turn {
        val invKey = pack.inventoryKey
        if (state.fightRound == null && invKey != null && digit == invKey &&
            offered(state).none { it.choice.digit == digit }
        ) {
            return Turn(state, listOf(said("${state.nodeId}:readback", readback(state))) + arrival(state))
        }

        if (state.fightRound != null) return pressInFight(state, digit)

        val offer = offered(state).firstOrNull { it.choice.digit == digit }
        if (offer == null) {
            val target = nodes[state.nodeId]?.invalidTarget
            if (target != null && nodes[target] != null) return enter(state, target)
            return Turn(
                state.copy(failedAttempts = state.failedAttempts + 1),
                listOf(said("${state.nodeId}:wrong", "That isn't one of the options.")) + arrival(state),
            )
        }

        val gate = offer.choice.gate
        if (!offer.open && gate != null) {
            if (gate.fail == "divert" && !gate.failNode.isNullOrEmpty()) {
                return withReaction(offer.choice, enter(state, gate.failNode))
            }
            val why = gate.failNarration?.trim().orEmpty()
            return Turn(
                state.copy(failedAttempts = state.failedAttempts + 1),
                listOf(Part("${offer.choice.id}:refuse", gate.failAudio, why.ifEmpty { "You can't do that yet." }, null)),
            )
        }

        var caller = state.caller
        var spent = emptyList<Part>()
        if (gate?.consumeOnPass == true) {
            val consumed = consumedBy(gate.expression, caller)
            caller = apply(caller, consumed.map { PackEffect(it, "revoke", null) })
            spent = spendClips(consumed)
        }

        val fx = offer.choice.effects
        val gained = clipsFor(fx)
        caller = apply(caller, fx)

        val to = offer.choice.to
        if (to == null) {
            return Turn(
                state.copy(caller = caller, failedAttempts = 0),
                spent + gained + said("${offer.choice.id}:unwritten", "(This branch is unwritten — nothing happens.)"),
            )
        }
        val arrival = enter(state.copy(caller = caller), to)
        return withReaction(offer.choice, arrival.copy(heard = spent + gained + arrival.heard))
    }

    /** The reaction, between the press and the arrival. */
    private fun withReaction(choice: PackChoice, arrival: Turn): Turn {
        val reaction = choice.reaction.filter { it.say.isNotBlankJs() || it.audio != null }
        if (reaction.isEmpty()) return arrival
        return arrival.copy(heard = reaction + arrival.heard)
    }

    private fun pressInFight(state: State, digit: String): Turn {
        val f = fightAt(state)
        val r = state.fightRound
        if (f == null || r == null) return Turn(state, emptyList())
        if (f.rounds.getOrNull(r) == null) return leaveFight(state, f, f.lose)

        val index = digit.toIntOrNull()?.minus(1)
        val move = if (index != null && index in 0 until MAX_FIGHT_MOVES) f.moves.getOrNull(index) else null
        if (move == null) return leaveFight(state, f, f.lose, "miss")

        val outcome = resolveMove(f, r, move.id)
        if (outcome.via == "advance" && outcome.nextRound != null) {
            val upcoming = f.rounds[outcome.nextRound]
            return Turn(
                state.copy(fightRound = outcome.nextRound, failedAttempts = 0, fightSilences = 0),
                listOf(Part(upcoming.id, upcoming.audio, upcoming.narration.ifEmpty { "${f.opponent}: ${upcoming.opponentMove}" }, null)),
            )
        }
        return leaveFight(state, f, outcome.nodeId, if (outcome.via == "advance") "lose" else outcome.via)
    }

    data class MoveOutcome(val nodeId: String?, val via: String, val nextRound: Int?)

    /** `resolveMove` — THE resolution rule for a fight. */
    fun resolveMove(f: PackFight, roundIndex: Int, moveId: String): MoveOutcome {
        val round = f.rounds.getOrNull(roundIndex) ?: return MoveOutcome(null, "lose", null)
        val named = f.outcomes.lastOrNull { it.round == round.id && it.move == moveId }
        if (named != null) return MoveOutcome(named.to, "named", null)
        val wanted = normalise(round.opponentMove)
        val counters = if (wanted.isEmpty()) emptyList() else f.moves.filter { normalise(it.beats) == wanted }
        if (counters.any { it.id == moveId }) {
            val next = roundIndex + 1
            if (next < f.rounds.size) return MoveOutcome(null, "advance", next)
            return MoveOutcome(f.win, "win", null)
        }
        return MoveOutcome(f.lose, "lose", null)
    }

    private fun leaveFight(state: State, f: PackFight, target: String?, via: String = "lose"): Turn {
        val call = when (via) {
            "win" -> "${f.opponent} goes down."
            "named" -> null
            else -> "${f.opponent} puts you down."
        }
        val lead = if (call != null) listOf(said("${f.id}:$via", call)) else emptyList()
        if (target == null || nodes[target] == null) {
            return Turn(
                state.copy(fightRound = null, fightSilences = 0, failedAttempts = state.failedAttempts + 1),
                listOf(said("${f.id}:$via:unwritten", "${call ?: "That answer."} (Nowhere is set for this answer — the branch is unwritten.)")),
            )
        }
        val arrival = enter(state, target)
        return arrival.copy(heard = lead + arrival.heard)
    }

    /** The caller said nothing in time. */
    fun timeout(state: State): Turn {
        if (state.fightRound != null) {
            val f = fightAt(state)
            if (f != null) {
                val silences = state.fightSilences + 1
                if (silences < f.patience) {
                    val again = roundPrompt(state)
                    return Turn(
                        state.copy(fightSilences = silences, failedAttempts = state.failedAttempts + 1),
                        if (again != null) listOf(said("${state.nodeId}:again", again)) else emptyList(),
                    )
                }
                return leaveFight(state, f, f.lose, "miss")
            }
        }
        val target = nodes[state.nodeId]?.timeoutTarget
        if (target != null && nodes[target] != null) return enter(state, target)
        return Turn(state.copy(failedAttempts = state.failedAttempts + 1), arrival(state))
    }

    private fun enter(state: State, nodeId: String): Turn {
        val here = nodes[nodeId] ?: return Turn(state, emptyList())
        val onArrival = here.effects
        val next = State(
            nodeId = nodeId,
            caller = apply(state.caller, onArrival),
            path = state.path + here.slug,
            failedAttempts = 0,
            finished = here.ending,
            fightRound = openingRound(nodeId),
            fightSilences = 0,
        )
        return Turn(next, clipsFor(onArrival) + arrival(next))
    }

    /** What a room says on being walked into — and what `start()` hands the screen. */
    fun arrival(state: State): List<Part> {
        val here = nodes[state.nodeId]
        val parts = here?.playback ?: emptyList()
        val written = parts.filter { it.say.isNotBlankJs() || it.audio != null }
        val out = written.ifEmpty { listOf(said("${state.nodeId}:empty", "(${here?.slug ?: "this room"} has no script yet)")) }
        val round = roundPrompt(state)
        return if (round != null) out + said("${state.nodeId}:round", round) else out
    }

    fun readback(state: State): String {
        val carried = pack.vars.filter { it.kind == "item" && has(state.caller, it.slug) }
        if (carried.isEmpty()) {
            return if (pack.inventoryEmptyAudio != null) "You are carrying nothing."
            else "(Carrying nothing — and there is no recording for that, so the phone says nothing at all.)"
        }
        val spoken = carried.map { v ->
            val name = v.name.ifEmpty { v.slug }
            if (v.nameAudio != null) name else "$name (no recording — silence on the phone)"
        }
        val lead = if (pack.inventoryIntroAudio != null) "You are carrying:" else "(No lead-in recorded.)"
        return "$lead ${spoken.joinToString(", ")}."
    }

    /** What the caller holds, for the status line. */
    fun held(state: State): List<String> {
        val out = mutableListOf<String>()
        for (v in pack.vars) {
            val name = v.name.trimJs().ifEmpty { v.slug }
            if (v.kind == "counter") {
                val n = slot[v.slug]?.let { state.caller.counters.getOrElse(it) { 0 } } ?: 0
                if (n > 0) out += "$name ×$n"
            } else if (bit[v.slug] != null && has(state.caller, v.slug)) out += name
        }
        return out
    }

    companion object {
        const val MAX_FIGHT_MOVES = 9
        fun normalise(s: String?) = (s ?: "").trimJs().lowercase()
    }
}

@Serializable
data class Caller(val mask: Int, val counters: List<Int>)

@Serializable
data class State(
    val nodeId: String,
    val caller: Caller,
    /** Slugs visited, in order. */
    val path: List<String>,
    val failedAttempts: Int,
    val finished: Boolean,
    val fightRound: Int?,
    val fightSilences: Int,
)

data class Turn(val next: State, val heard: List<Part>)

data class OfferedChoice(val choice: PackChoice, val open: Boolean)

/** One lit key on the keypad. */
data class Offer(val digit: String, val label: String, val open: Boolean, val choiceId: String?)

/**
 * JavaScript's `String.prototype.trim`, which strips a wider set of whitespace
 * than Kotlin's `trim()` defaults to agreeing on in every case — line
 * separators and BOMs among them. The engines must agree on what counts as
 * "nothing written", so this matches JS rather than guessing.
 */
internal fun String.trimJs(): String = trim { it.isWhitespace() || it == '﻿' || it == ' ' }

internal fun String.isNotBlankJs(): Boolean = trimJs().isNotEmpty()
