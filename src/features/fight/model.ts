import type { Digit, Fight, FightMove, FightRound, StoryGraph } from '@/types/domain'

/**
 * A fight, as a pure view over the graph.
 *
 * Same seam as `roomModel`: no React, no store, so the editor, the playtest
 * runtime, the exporter and the validator all read one description of what a
 * fight is rather than each deciding for itself.
 *
 * The rules, in full:
 *   - The room's own narration plays first, as the lead-in.
 *   - Each round, the opponent announces a move (`round.opponent_move`) and the
 *     round's narration is read.
 *   - The caller presses a digit. Digits are assigned by move order: the first
 *     move is 1, the second 2, and so on.
 *   - The move whose `beats` matches the announced move is the right answer. It
 *     advances to the next round.
 *   - Anything else — a wrong move, an unmapped digit — loses, immediately.
 *   - Answering the last round correctly wins.
 */

/** The keypad runs out at 9, and a fight offering ten moves is not a fight. */
export const MAX_FIGHT_MOVES = 9

export interface FightView {
  fight: Fight
  /** In `sort_order`. The index is the digit, minus one. */
  moves: FightMove[]
  rounds: FightRound[]
  winTitle: string | null
  loseTitle: string | null
  /** Everything wrong with this fight, in plain words (F4-style validation). */
  problems: string[]
}

/** Move names are author-typed on both sides of the match, so compare them the
 *  way a person would rather than the way a database would. */
export const normaliseMove = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function fightFor(graph: StoryGraph, nodeId: string): Fight | null {
  for (const f of graph.fights.values()) if (f.node_id === nodeId) return f
  return null
}

export function movesOf(graph: StoryGraph, fightId: string): FightMove[] {
  return [...graph.fightMoves.values()]
    .filter((m) => m.fight_id === fightId)
    .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug))
}

export function roundsOf(graph: StoryGraph, fightId: string): FightRound[] {
  return [...graph.fightRounds.values()]
    .filter((r) => r.fight_id === fightId)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** The digit that presses a move. Null past the ninth, which is a problem the
 *  validator reports rather than something to render. */
export function digitForMove(moves: FightMove[], moveId: string): Digit | null {
  const i = moves.findIndex((m) => m.id === moveId)
  if (i < 0 || i >= MAX_FIGHT_MOVES) return null
  return String(i + 1) as Digit
}

/** The move that answers a round, or null if nothing does. */
export function counterFor(moves: FightMove[], round: FightRound): FightMove | null {
  const wanted = normaliseMove(round.opponent_move)
  if (!wanted) return null
  return moves.find((m) => normaliseMove(m.beats) === wanted) ?? null
}

export function buildFightView(graph: StoryGraph, nodeId: string): FightView | null {
  const fight = fightFor(graph, nodeId)
  if (!fight) return null

  const moves = movesOf(graph, fight.id)
  const rounds = roundsOf(graph, fight.id)
  const titleOf = (id: string | null) => {
    if (!id) return null
    const n = graph.nodes.get(id)
    return n ? n.title || n.slug : null
  }

  return {
    fight,
    moves,
    rounds,
    winTitle: titleOf(fight.win_node_id),
    loseTitle: titleOf(fight.lose_node_id),
    problems: fightProblems(fight, moves, rounds),
  }
}

/**
 * What is wrong with this fight.
 *
 * The unwinnable-round check is the one that matters: a round announcing a move
 * no move counters is a dead end that looks completely fine in the editor, and
 * on the phone it kills every caller who reaches it.
 */
export function fightProblems(
  fight: Fight,
  moves: FightMove[],
  rounds: FightRound[],
): string[] {
  const problems: string[] = []

  if (moves.length === 0) problems.push('No moves yet — the caller has nothing to press.')
  if (rounds.length === 0) problems.push('No rounds yet — the fight ends before it begins.')
  if (moves.length > MAX_FIGHT_MOVES) {
    problems.push(
      `${moves.length} moves, but the keypad only reaches ${MAX_FIGHT_MOVES} — the rest can never be pressed.`,
    )
  }

  // Two moves claiming the same counter: the second can never be the right
  // answer, so one of them is dead weight the author probably didn't intend.
  const byBeats = new Map<string, FightMove[]>()
  for (const m of moves) {
    const key = normaliseMove(m.beats)
    if (!key) {
      problems.push(`${m.slug} doesn't counter anything yet.`)
      continue
    }
    byBeats.set(key, [...(byBeats.get(key) ?? []), m])
  }
  for (const [beats, claimants] of byBeats) {
    if (claimants.length > 1) {
      problems.push(
        `${claimants.map((m) => m.slug).join(' and ')} both counter "${beats}" — only the first will ever be right.`,
      )
    }
  }

  rounds.forEach((round, i) => {
    if (!round.opponent_move.trim()) {
      problems.push(`Round ${i + 1} doesn't say what the opponent does.`)
      return
    }
    const counter = counterFor(moves, round)
    if (!counter) {
      problems.push(
        `Round ${i + 1}: nothing counters "${round.opponent_move}", so this fight cannot be won.`,
      )
      return
    }
    if (!digitForMove(moves, counter.id)) {
      problems.push(
        `Round ${i + 1} is answered by ${counter.slug}, which is past the ninth move and has no digit.`,
      )
    }
  })

  if (!fight.win_node_id) problems.push('Nowhere to go after winning.')
  if (!fight.lose_node_id) {
    problems.push('Nowhere to go after losing — a wrong answer would leave the caller in limbo.')
  }

  return problems
}

/** Fights indexed by the room they hang off, for anything walking the graph. */
export function fightsByNode(graph: StoryGraph): Map<string, Fight> {
  const out = new Map<string, Fight>()
  for (const f of graph.fights.values()) out.set(f.node_id, f)
  return out
}
