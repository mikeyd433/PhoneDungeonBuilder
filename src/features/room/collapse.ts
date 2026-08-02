import type { DerivedGraph, StoryGraph } from '@/types/domain'

/**
 * Splicing a room out of the graph.
 *
 * The Brainstorm import turned every node into a room, but plenty of those
 * nodes were *actions* — "enter door", "pick it up" — that belong on the door
 * rather than behind it. Collapsing one repoints everything that led to it at
 * whatever it led to, then deletes it, leaving the two rooms either side joined.
 *
 * Planning is separated from doing so the reasons a room *can't* be collapsed
 * are testable and can be shown before anything is destroyed.
 */

export type InboundRepoint =
  | { kind: 'choice'; choiceId: string; fromNodeId: string; fillLabel: string | null }
  | { kind: 'fight-win'; fightId: string }
  | { kind: 'fight-lose'; fightId: string }
  | { kind: 'fight-move'; roundId: string; moveId: string }

export interface CollapsePlan {
  nodeId: string
  /** What everything pointing at this room will point at instead. */
  toNodeId: string
  toTitle: string
  inbound: InboundRepoint[]
  /** Rooms whose silence/wrong-key redirect lands here and must follow. */
  redirects: Array<{ nodeId: string; field: 'timeout_target_id' | 'invalid_target_id' }>
  /** Wired exits being dropped — extra doors that led to the same place. */
  droppedExits: number
  /** Unwritten exits that go with the room. */
  droppedBricked: number
  /** Doors that will inherit this room's name, because they had no label. */
  labelsFilled: number
  /** True when the room is only reachable as a dead end — nothing points at it. */
  orphan: boolean
}

export type CollapseCheck = { ok: true; plan: CollapsePlan } | { ok: false; reason: string }

export function planCollapse(
  graph: StoryGraph,
  derived: DerivedGraph,
  nodeId: string,
): CollapseCheck {
  const node = graph.nodes.get(nodeId)
  if (!node) return { ok: false, reason: 'That room is gone.' }

  // The story has to start somewhere, and `stories.root_node_id` is ON DELETE
  // SET NULL — collapsing the entrance would quietly leave the story with no
  // way in at all.
  if (graph.story.root_node_id === nodeId) {
    return { ok: false, reason: 'This is the entrance. The story has to start somewhere.' }
  }
  if (node.node_type === 'ending') {
    return { ok: false, reason: 'An ending has nothing on the other side to join to.' }
  }
  if ([...graph.fights.values()].some((f) => f.node_id === nodeId)) {
    return { ok: false, reason: 'This room is a fight. Where the caller ends up is won, not passed through.' }
  }

  // Anything hung off the room would be destroyed with it, and unlike the room
  // itself it cannot be put back. Clearing it first is a decision worth making
  // deliberately rather than inside a collapse.
  if ([...graph.dialogue.values()].some((l) => l.node_id === nodeId)) {
    return { ok: false, reason: 'This room has dialogue lines. Collapse it back to plain narration first.' }
  }
  const choiceIds = new Set((derived.children.get(nodeId) ?? []).map((c) => c.id))
  if (
    [...graph.effects.values()].some(
      (e) => e.node_id === nodeId || (e.choice_id !== null && choiceIds.has(e.choice_id)),
    )
  ) {
    return { ok: false, reason: 'This room gives or takes something. Clear that first.' }
  }
  if ([...graph.gates.values()].some((g) => choiceIds.has(g.choice_id))) {
    return { ok: false, reason: 'A door out of this room is gated. Clear the gate first.' }
  }

  const exits = derived.children.get(nodeId) ?? []
  const wired = exits.filter((c) => c.to_node_id)
  const targets = new Set(wired.map((c) => c.to_node_id as string))

  if (targets.size === 0) {
    return { ok: false, reason: 'This room has no way onward, so there is nothing to join to.' }
  }
  // Several doors to the same place still means one way onward, which is
  // exactly the shape an "enter door" node tends to have.
  if (targets.size > 1) {
    return {
      ok: false,
      reason: `This room leads to ${targets.size} different rooms, so there is no single place to send its doors. Point them at one room, or delete the extras.`,
    }
  }

  const toNodeId = [...targets][0]
  if (toNodeId === nodeId) {
    return { ok: false, reason: 'This room leads to itself.' }
  }
  const to = graph.nodes.get(toNodeId)
  if (!to) return { ok: false, reason: 'The room on the other side is missing.' }

  const inbound: InboundRepoint[] = []
  let labelsFilled = 0
  const roomName = node.title || node.slug

  for (const edge of derived.edgesTo.get(nodeId) ?? []) {
    if (edge.choice) {
      // An unlabelled door leading to an "enter door" room means the caller
      // hears that room read out. Collapsing would delete those words entirely,
      // so they move onto the door — which is where they always belonged.
      const fillLabel = edge.choice.label.trim() === '' ? roomName : null
      if (fillLabel) labelsFilled++
      inbound.push({
        kind: 'choice',
        choiceId: edge.choice.id,
        fromNodeId: edge.from_node_id,
        fillLabel,
      })
      continue
    }
    if (edge.kind === 'fight-win' || edge.kind === 'fight-lose') {
      const fight = [...graph.fights.values()].find((f) => f.node_id === edge.from_node_id)
      if (fight) inbound.push({ kind: edge.kind, fightId: fight.id })
      continue
    }
    if (edge.kind === 'fight-move') {
      const outcome = [...graph.fightOutcomes.values()].find(
        (o) => o.to_node_id === nodeId && graph.fights.get(o.fight_id)?.node_id === edge.from_node_id,
      )
      if (outcome) {
        inbound.push({ kind: 'fight-move', roundId: outcome.round_id, moveId: outcome.move_id })
      }
    }
  }

  // These are ON DELETE SET NULL, so leaving them alone would silently turn a
  // deliberate "on silence, go here" into "repeat the room".
  const redirects: CollapsePlan['redirects'] = []
  for (const n of graph.nodes.values()) {
    if (n.id === nodeId) continue
    if (n.timeout_target_id === nodeId) redirects.push({ nodeId: n.id, field: 'timeout_target_id' })
    if (n.invalid_target_id === nodeId) redirects.push({ nodeId: n.id, field: 'invalid_target_id' })
  }

  return {
    ok: true,
    plan: {
      nodeId,
      toNodeId,
      toTitle: to.title || to.slug,
      inbound,
      redirects,
      droppedExits: wired.length - 1,
      droppedBricked: exits.length - wired.length,
      labelsFilled,
      orphan: inbound.length === 0,
    },
  }
}

/** What the confirmation says, so the wording is testable and not buried in JSX. */
export function describeCollapse(plan: CollapsePlan, roomName: string): string {
  const lines = [`Collapse ${roomName}?`, '']

  if (plan.orphan) {
    lines.push(`Nothing leads here, so this just removes it. ${plan.toTitle} keeps its other ways in.`)
  } else {
    const ways = plan.inbound.length
    lines.push(`${ways} way${ways === 1 ? '' : 's'} in will point straight at ${plan.toTitle} instead.`)
  }
  if (plan.labelsFilled > 0) {
    lines.push(
      `${plan.labelsFilled} unlabelled door${plan.labelsFilled === 1 ? '' : 's'} will be labelled "${roomName}", so those words are still heard.`,
    )
  }
  if (plan.redirects.length > 0) {
    lines.push(`${plan.redirects.length} silence/wrong-key redirect${plan.redirects.length === 1 ? '' : 's'} will follow.`)
  }
  if (plan.droppedExits > 0) {
    lines.push(`${plan.droppedExits} spare door${plan.droppedExits === 1 ? '' : 's'} to the same room will go.`)
  }
  if (plan.droppedBricked > 0) {
    lines.push(`${plan.droppedBricked} unwritten branch${plan.droppedBricked === 1 ? '' : 'es'} will go.`)
  }
  lines.push('', 'Its narration and any recording are deleted. Undo puts it back.')
  return lines.join('\n')
}
