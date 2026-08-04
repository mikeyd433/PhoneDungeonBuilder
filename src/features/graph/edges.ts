import type { GraphEdge, StoryGraph } from '@/types/domain'

/**
 * The graph's edges, choices and fight outcomes alike.
 *
 * Structure — depth, reachability, orphans, back-edges, traps, the automap's
 * lines — is computed over these rather than over `graph.choices`, because a
 * fight's win and lose rooms are reached without any choice row existing. The
 * first version of the fight feature left them out and the ledger immediately
 * reported every post-fight room as an orphan, which was both wrong and the
 * exact failure §2 warns about when structure is stored rather than derived.
 *
 * Exits are still choices only. A fight is answered with moves, not doors, so
 * nothing here leaks into the room's walls.
 */

export const fightEdgeId = (fightId: string, outcome: 'win' | 'lose') =>
  `fight:${fightId}:${outcome}`

export const fightMoveEdgeId = (outcomeId: string) => `fightmove:${outcomeId}`


export const divertEdgeId = (gateId: string) => `divert:${gateId}`

export function graphEdges(graph: StoryGraph): GraphEdge[] {
  const edges: GraphEdge[] = []

  for (const choice of graph.choices.values()) {
    edges.push({
      id: choice.id,
      kind: 'choice',
      from_node_id: choice.from_node_id,
      to_node_id: choice.to_node_id,
      digit: choice.digit,
      label: choice.label,
      sort_order: choice.sort_order,
      choice,
    })
  }

  for (const fight of graph.fights.values()) {
    // A fight with no room is impossible in the database (the FK is NOT NULL),
    // but an in-memory graph mid-edit can hold one, and a dangling edge would
    // corrupt every derived set at once.
    if (!graph.nodes.has(fight.node_id)) continue
    edges.push({
      id: fightEdgeId(fight.id, 'win'),
      kind: 'fight-win',
      from_node_id: fight.node_id,
      to_node_id: fight.win_node_id,
      digit: null,
      label: `beat ${fight.opponent_name}`,
      // Sorted after every keypad digit so a fight room's win/lose never jump
      // ahead of a choice in any digit-ordered list.
      sort_order: 100,
      choice: null,
    })
    edges.push({
      id: fightEdgeId(fight.id, 'lose'),
      kind: 'fight-lose',
      from_node_id: fight.node_id,
      to_node_id: fight.lose_node_id,
      digit: null,
      label: `lose to ${fight.opponent_name}`,
      sort_order: 101,
      choice: null,
    })
  }

  // A round that names where a move goes is a way through the dungeon like any
  // other. Leaving these out would have the rooms they reach report as sealed —
  // the same failure that made win/lose edges necessary in the first place.
  for (const outcome of graph.fightOutcomes.values()) {
    const fight = graph.fights.get(outcome.fight_id)
    if (!fight || !graph.nodes.has(fight.node_id)) continue
    const move = graph.fightMoves.get(outcome.move_id)
    edges.push({
      id: fightMoveEdgeId(outcome.id),
      kind: 'fight-move',
      from_node_id: fight.node_id,
      to_node_id: outcome.to_node_id,
      digit: null,
      label: move ? `answer with ${move.slug}` : 'answer',
      sort_order: 102,
      choice: null,
    })
  }

  /**
   * The other side of a fork.
   *
   * A `divert` gate sends the caller to a room no choice row points at — the
   * same shape as a fight's win room, and left out for exactly as long. The map
   * never drew it and the ledger reported the room beyond it as sealed, which
   * is the failure §2 warns about when structure is not derived over edges.
   *
   * `choice: null`, so it is never a door: the caller presses the digit the
   * choice already owns, and this is where the gate sends them instead.
   */
  for (const gate of graph.gates.values()) {
    if (gate.fail_behavior !== 'divert') continue
    const choice = graph.choices.get(gate.choice_id)
    if (!choice || !graph.nodes.has(choice.from_node_id)) continue
    edges.push({
      id: divertEdgeId(gate.id),
      kind: 'divert',
      from_node_id: choice.from_node_id,
      to_node_id: gate.fail_node_id,
      digit: null,
      label: choice.label ? `${choice.label}, without` : 'the other way',
      // Beside the door it forks from, and after it: a digit-ordered list must
      // still lead with the key the caller presses.
      sort_order: choice.sort_order + 0.5,
      choice: null,
    })
  }

  return edges
}
