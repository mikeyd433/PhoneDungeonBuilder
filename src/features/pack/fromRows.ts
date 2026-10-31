import type { StoryGraph } from '@/types/domain'

/**
 * A StoryGraph from raw table rows — the same shape `loadStory` in
 * `lib/api.ts` builds from Supabase, for tools that read the database some
 * other way (a dump, the SQL editor) and want a story pack out of it.
 *
 * Rows go into each Map in the order given, which is the order the engines
 * see them in (bit positions, tie-breaks), so pass them as the database
 * returns them.
 */
export interface StoryRows {
  story: StoryGraph['story']
  nodes?: unknown[]
  choices?: unknown[]
  state_vars?: unknown[]
  effects?: unknown[]
  gates?: unknown[]
  characters?: unknown[]
  dialogue_lines?: unknown[]
  fights?: unknown[]
  fight_moves?: unknown[]
  fight_rounds?: unknown[]
  fight_round_outcomes?: unknown[]
}

const index = <T extends { id: string }>(rows: unknown[] | undefined) =>
  new Map(((rows ?? []) as T[]).map((r) => [r.id, r]))

export function graphFromRows(rows: StoryRows): StoryGraph {
  return {
    story: rows.story,
    nodes: index(rows.nodes),
    choices: index(rows.choices),
    stateVars: index(rows.state_vars),
    effects: index(rows.effects),
    gates: index(rows.gates),
    characters: index(rows.characters),
    dialogue: index(rows.dialogue_lines),
    fights: index(rows.fights),
    fightMoves: index(rows.fight_moves),
    fightRounds: index(rows.fight_rounds),
    fightOutcomes: index(rows.fight_round_outcomes),
  }
}

/** The inverse of `graphFromRows`: table rows in Map order. */
export function rowsFromGraph(graph: StoryGraph): StoryRows {
  return {
    story: graph.story,
    nodes: [...graph.nodes.values()],
    choices: [...graph.choices.values()],
    state_vars: [...graph.stateVars.values()],
    effects: [...graph.effects.values()],
    gates: [...graph.gates.values()],
    characters: [...graph.characters.values()],
    dialogue_lines: [...graph.dialogue.values()],
    fights: [...graph.fights.values()],
    fight_moves: [...graph.fightMoves.values()],
    fight_rounds: [...graph.fightRounds.values()],
    fight_round_outcomes: [...graph.fightOutcomes.values()],
  }
}
