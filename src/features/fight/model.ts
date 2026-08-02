import type {
  Digit,
  Fight,
  FightMove,
  FightRound,
  FightRoundOutcome,
  StoryGraph,
} from '@/types/domain'

/**
 * A fight, as a pure view over the graph.
 *
 * Same seam as `roomModel`: no React, no store, so the editor, the playtest
 * runtime, the exporter and the validator all read one description of what a
 * fight is rather than each deciding for itself.
 *
 * A fight is functionally a room where you pick an exit. Each round announces
 * something, the caller presses a digit, and that digit goes somewhere — three
 * different places, or all to the same place, or onward to the next round. What
 * makes it a fight rather than three ordinary rooms is that the digits mean the
 * same thing every round: press 1 for PUNCH throughout.
 *
 * Where a digit goes is decided in this order:
 *
 *   1. The round names a destination for that move  -> go there.
 *      (Named with a null destination = written but unwired; that is a bricked
 *      archway and the validator says so.)
 *   2. The move counters what the opponent announced -> the next round, or the
 *      fight's win room if this was the last round.
 *   3. Otherwise                                    -> the fight's lose room.
 *
 * Rules 2 and 3 are what keep a plain three-move fight a two-column table
 * instead of a nine-cell grid. Several moves may counter the same announcement,
 * which is how "any of these gets you through" is said without filling the grid
 * in either.
 */

/** The keypad runs out at 9, and a fight offering ten moves is not a fight. */
export const MAX_FIGHT_MOVES = 9

/** How a move's destination was arrived at. Drives what the editor shows and
 *  what the build sheet explains. */
export type OutcomeVia = 'named' | 'advance' | 'win' | 'lose'

export interface MoveOutcome {
  /** Null when the branch has nowhere to go — unwired, or a fallback room the
   *  author hasn't set. Never null for `advance`, which stays inside the fight. */
  nodeId: string | null
  via: OutcomeVia
  /** For `advance`: the round the caller lands on next. */
  nextRound: number | null
}

/** One cell of the round table: what pressing this digit, this round, does. */
export interface FightCell {
  digit: string
  move: FightMove
  via: OutcomeVia
  /** Where it goes, already named: a room title, or "round 2". */
  where: string
  /** False when the branch has nowhere to go — render it as a dead end. */
  wired: boolean
}

export interface FightView {
  fight: Fight
  /** In `sort_order`. The index is the digit, minus one. */
  moves: FightMove[]
  rounds: FightRound[]
  /** Keyed `roundId:moveId`. */
  outcomes: Map<string, FightRoundOutcome>
  /**
   * Every round, with every digit resolved and named.
   *
   * Computed here rather than in the renderer because naming a destination
   * needs the node table, and a renderer that reached for the graph would
   * break the seam that lets a sprite pack consume this same view.
   */
  table: Array<{ round: FightRound; cells: FightCell[] }>
  winTitle: string | null
  loseTitle: string | null
  /** Everything wrong with this fight, in plain words (F4-style validation). */
  problems: string[]
}

/** Move names are author-typed on both sides of the match, so compare them the
 *  way a person would rather than the way a database would. */
export const normaliseMove = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export const outcomeKey = (roundId: string, moveId: string) => `${roundId}:${moveId}`

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

export function outcomesOf(
  graph: StoryGraph,
  fightId: string,
): Map<string, FightRoundOutcome> {
  const out = new Map<string, FightRoundOutcome>()
  for (const o of graph.fightOutcomes.values()) {
    if (o.fight_id === fightId) out.set(outcomeKey(o.round_id, o.move_id), o)
  }
  return out
}

/** The digit that presses a move. Null past the ninth, which is a problem the
 *  validator reports rather than something to render. */
export function digitForMove(moves: FightMove[], moveId: string): Digit | null {
  const i = moves.findIndex((m) => m.id === moveId)
  if (i < 0 || i >= MAX_FIGHT_MOVES) return null
  return String(i + 1) as Digit
}

/** Every move that answers a round. Usually one; more when several share a
 *  `beats`, which is legitimate. */
export function countersFor(moves: FightMove[], round: FightRound): FightMove[] {
  const wanted = normaliseMove(round.opponent_move)
  if (!wanted) return []
  return moves.filter((m) => normaliseMove(m.beats) === wanted)
}

/** The first move that answers a round, for callers that only want one. */
export function counterFor(moves: FightMove[], round: FightRound): FightMove | null {
  return countersFor(moves, round)[0] ?? null
}

/**
 * Where pressing one move in one round takes the caller.
 *
 * This is THE resolution rule. The editor, the playtest runtime and the
 * exporter all go through it, so a fight cannot behave one way on screen and
 * another on the phone.
 */
export function resolveMove(
  view: Pick<FightView, 'fight' | 'moves' | 'rounds' | 'outcomes'>,
  roundIndex: number,
  moveId: string,
): MoveOutcome {
  const round = view.rounds[roundIndex]
  if (!round) return { nodeId: null, via: 'lose', nextRound: null }

  const named = view.outcomes.get(outcomeKey(round.id, moveId))
  if (named) return { nodeId: named.to_node_id, via: 'named', nextRound: null }

  const counters = countersFor(view.moves, round)
  if (counters.some((m) => m.id === moveId)) {
    const next = roundIndex + 1
    if (next < view.rounds.length) return { nodeId: null, via: 'advance', nextRound: next }
    return { nodeId: view.fight.win_node_id, via: 'win', nextRound: null }
  }

  return { nodeId: view.fight.lose_node_id, via: 'lose', nextRound: null }
}

/** Where an unmapped digit, or silence, takes the caller. Always the lose room:
 *  a fight you can wait out is not a fight. */
export function resolveMiss(view: Pick<FightView, 'fight'>): string | null {
  return view.fight.lose_node_id
}

export function buildFightView(graph: StoryGraph, nodeId: string): FightView | null {
  const fight = fightFor(graph, nodeId)
  if (!fight) return null

  const moves = movesOf(graph, fight.id)
  const rounds = roundsOf(graph, fight.id)
  const outcomes = outcomesOf(graph, fight.id)
  const titleOf = (id: string | null) => {
    if (!id) return null
    const n = graph.nodes.get(id)
    return n ? n.title || n.slug : null
  }

  const core = { fight, moves, rounds, outcomes }
  const table = rounds.map((round, i) => ({
    round,
    cells: moves.slice(0, MAX_FIGHT_MOVES).map((move, m): FightCell => {
      const outcome = resolveMove(core, i, move.id)
      const advancing = outcome.via === 'advance' && outcome.nextRound !== null
      return {
        digit: String(m + 1),
        move,
        via: outcome.via,
        where: advancing
          ? `round ${(outcome.nextRound ?? 0) + 1}`
          : (titleOf(outcome.nodeId) ?? 'nowhere yet'),
        wired: advancing || Boolean(outcome.nodeId),
      }
    }),
  }))

  return {
    ...core,
    table,
    winTitle: titleOf(fight.win_node_id),
    loseTitle: titleOf(fight.lose_node_id),
    problems: fightProblems(core),
  }
}

/**
 * What is wrong with this fight.
 *
 * The check that matters is per round: can pressing ANYTHING get the caller
 * somewhere other than a dead stop? A round where every digit leads nowhere
 * looks completely fine in the editor and kills every caller who reaches it.
 *
 * What this deliberately does NOT complain about: several moves countering the
 * same announcement, a round with no "right" answer because every move names
 * the same destination, or a blank announcement on a round whose destinations
 * are all named. Those were mistakes in the first version of this validator —
 * they are all legitimate fights.
 */
export function fightProblems(
  view: Pick<FightView, 'fight' | 'moves' | 'rounds' | 'outcomes'>,
): string[] {
  const { fight, moves, rounds } = view
  const problems: string[] = []

  if (moves.length === 0) problems.push('No moves yet — the caller has nothing to press.')
  if (rounds.length === 0) problems.push('No rounds yet — the fight ends before it begins.')
  if (moves.length > MAX_FIGHT_MOVES) {
    problems.push(
      `${moves.length} moves, but the keypad only reaches ${MAX_FIGHT_MOVES} — the rest can never be pressed.`,
    )
  }

  const playable = moves.slice(0, MAX_FIGHT_MOVES)
  let usesWin = false
  let usesLose = false

  rounds.forEach((round, i) => {
    let anyForward = false
    let named = 0

    playable.forEach((move, m) => {
      const outcome = resolveMove(view, i, move.id)
      if (outcome.via === 'named') named += 1
      if (outcome.via === 'win') usesWin = true
      if (outcome.via === 'lose') usesLose = true

      if (outcome.via === 'advance' || outcome.nodeId) {
        anyForward = true
      } else if (outcome.via === 'named') {
        problems.push(`Round ${i + 1}: pressing ${m + 1} (${move.slug}) leads nowhere yet.`)
      }
    })

    if (playable.length > 0 && !anyForward) {
      problems.push(`Round ${i + 1}: nothing gets past this — every answer stops the fight.`)
    }
    // Only a round that leans on the counter rule needs an announcement; one
    // whose destinations are all named doesn't have a "right" answer to match.
    if (!round.opponent_move.trim() && named < playable.length) {
      problems.push(`Round ${i + 1} doesn't say what the opponent does.`)
    }
  })

  if (usesWin && !fight.win_node_id) problems.push('Nowhere to go after winning.')
  if (!fight.lose_node_id) {
    // The lose room catches unmapped digits and silence in every round, so it
    // is needed even by a fight where no move falls through to it.
    problems.push(
      usesLose
        ? 'Nowhere to go after losing — a wrong answer would leave the caller in limbo.'
        : 'Nowhere to go after losing — a digit no move uses, or silence, would leave the caller in limbo.',
    )
  }

  return problems
}

/** Fights indexed by the room they hang off, for anything walking the graph. */
export function fightsByNode(graph: StoryGraph): Map<string, Fight> {
  const out = new Map<string, Fight>()
  for (const f of graph.fights.values()) out.set(f.node_id, f)
  return out
}
