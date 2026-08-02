import type {
  Choice,
  DerivedGraph,
  Digit,
  Effect,
  Gate,
  StoryGraph,
  StoryNode,
} from '@/types/domain'
import { WALL_EXITS } from '@/types/domain'

/**
 * What one room shows, derived from a single node's record.
 *
 * This is deliberately a pure data structure with no React in it. Spec §3 asks
 * that every visual element encode real data and nothing be atmosphere for its
 * own sake — keeping the mapping here, rather than scattered through JSX, makes
 * that rule checkable and lets a sprite renderer consume exactly the same model
 * as the vector one.
 */

export type ExitKind =
  /** A choice with a destination — an archway with the digit carved on the lintel. */
  | 'door'
  /** A back-edge. Drawn as a spiral stairwell so reconvergence doesn't read as
   *  branching (F1.6) — the thing the old flowchart was worst at showing. */
  | 'portal'
  /** A choice with no destination, or an empty slot. Bricked over; tap to chisel. */
  | 'bricked'

export interface ExitView {
  kind: ExitKind
  digit: Digit
  label: string
  /** null for `bricked`. */
  choiceId: string | null
  targetId: string | null
  targetTitle: string | null
  /** Which wall: 0 = left, 1 = centre, 2 = right. */
  slot: number
  /** F1.7 — a chest at this door means the choice grants something. */
  grants: string[]
  /** A hole in the floor by this door means it revokes something. */
  revokes: string[]
  /** F1.8 — an iron portcullis. Null when the choice has no gate. */
  gate: { behavior: 'hide' | 'refuse' | 'divert'; conditionCount: number } | null
}

export interface RoomView {
  node: StoryNode
  /** Up to three wall exits (§11.1). */
  exits: ExitView[]
  /** F1.13 — digits 4–9 render as a stacked list rather than walls. */
  overflowExits: ExitView[]
  /** F1.4 / F1.12 — inbound choices. More than one means a retreat chooser. */
  retreats: Array<{ choiceId: string; fromId: string; fromTitle: string }>
  /** F1.11 — rooms sharing a parent with this one, in digit order, including
   *  this room. Swiping the floor plaque cycles them, so a whole choice set can
   *  be reviewed without walking back up. */
  siblings: string[]
  /** F1.5 — lit when audio exists. Unfinished territory is literally dark. */
  torchLit: boolean
  /** F1.9 — rubble and a skull, no exits. */
  isEnding: boolean
  /** F1.10 — depth notches on the wall. Null when unreachable. */
  depth: number | null
  /** Effects that fire on arrival: a chest on the floor, centre. */
  arrivalGrants: string[]
  arrivalRevokes: string[]
  /** Structural warnings surfaced in the room itself, not just the ledger. */
  isOrphan: boolean
  isUnreachable: boolean
  /** An ending that still has exits — §2 says enforce in the app, not the DB. */
  endingWithExits: boolean
}

function varSlug(graph: StoryGraph, effect: Effect): string {
  return graph.stateVars.get(effect.state_var_id)?.slug ?? '?'
}

function countConditions(expression: unknown): number {
  if (!expression || typeof expression !== 'object') return 0
  const node = expression as { op?: string; args?: unknown[] }
  if (!node.op) return 0
  if (node.op === 'and' || node.op === 'or' || node.op === 'not') {
    return (node.args ?? []).reduce<number>((sum, arg) => sum + countConditions(arg), 0)
  }
  return 1 // a leaf: has / lacks / gte / lte / eq
}

export function buildRoomView(
  graph: StoryGraph,
  derived: DerivedGraph,
  nodeId: string,
): RoomView | null {
  const node = graph.nodes.get(nodeId)
  if (!node) return null

  const outgoing = derived.children.get(nodeId) ?? []

  const effectsFor = (predicate: (e: Effect) => boolean) => {
    const grants: string[] = []
    const revokes: string[] = []
    for (const effect of graph.effects.values()) {
      if (!predicate(effect)) continue
      if (effect.operation === 'grant' || effect.operation === 'add') {
        grants.push(varSlug(graph, effect))
      } else {
        revokes.push(varSlug(graph, effect))
      }
    }
    return { grants, revokes }
  }

  const gateByChoice = new Map<string, Gate>()
  for (const gate of graph.gates.values()) gateByChoice.set(gate.choice_id, gate)

  const toExit = (choice: Choice, slot: number): ExitView => {
    const { grants, revokes } = effectsFor((e) => e.choice_id === choice.id)
    const gate = gateByChoice.get(choice.id)
    const target = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : undefined
    return {
      kind: !choice.to_node_id ? 'bricked' : derived.portals.has(choice.id) ? 'portal' : 'door',
      digit: choice.digit,
      label: choice.label,
      choiceId: choice.id,
      targetId: choice.to_node_id,
      targetTitle: target?.title || target?.slug || null,
      slot,
      grants,
      revokes,
      gate: gate
        ? { behavior: gate.fail_behavior, conditionCount: countConditions(gate.expression) }
        : null,
    }
  }

  const exits: ExitView[] = outgoing.slice(0, WALL_EXITS).map(toExit)
  const overflowExits: ExitView[] = outgoing
    .slice(WALL_EXITS)
    .map((c, i) => toExit(c, WALL_EXITS + i))

  // Pad the walls out to three so empty slots render as bricked archways you can
  // chisel through — the primary way new rooms get made (F1.3).
  const usedDigits = new Set(outgoing.map((c) => c.digit))
  const isEnding = node.node_type === 'ending'
  if (!isEnding) {
    let nextDigit = 1
    while (exits.length < WALL_EXITS) {
      while (nextDigit <= 9 && usedDigits.has(String(nextDigit) as Digit)) nextDigit++
      if (nextDigit > 9) break
      exits.push({
        kind: 'bricked',
        digit: String(nextDigit) as Digit,
        label: '',
        choiceId: null,
        targetId: null,
        targetTitle: null,
        slot: exits.length,
        grants: [],
        revokes: [],
        gate: null,
      })
      usedDigits.add(String(nextDigit) as Digit)
      nextDigit++
    }
  }
  exits.forEach((e, i) => (e.slot = i))

  const arrival = effectsFor((e) => e.node_id === nodeId)

  const retreats = (derived.parents.get(nodeId) ?? []).map((c) => {
    const from = graph.nodes.get(c.from_node_id)
    return {
      choiceId: c.id,
      fromId: c.from_node_id,
      fromTitle: from?.title || from?.slug || 'somewhere',
    }
  })

  // Siblings share a parent. Deduped across parents, because a room reached
  // from two places would otherwise appear twice in the cycle.
  const siblings: string[] = []
  const seenSibling = new Set<string>()
  for (const inbound of derived.parents.get(nodeId) ?? []) {
    for (const peer of derived.children.get(inbound.from_node_id) ?? []) {
      if (peer.to_node_id && !seenSibling.has(peer.to_node_id)) {
        seenSibling.add(peer.to_node_id)
        siblings.push(peer.to_node_id)
      }
    }
  }

  return {
    node,
    exits,
    overflowExits,
    retreats,
    siblings,
    torchLit: Boolean(node.audio_path),
    isEnding,
    depth: derived.depth.get(nodeId) ?? null,
    arrivalGrants: arrival.grants,
    arrivalRevokes: arrival.revokes,
    isOrphan: derived.orphans.has(nodeId),
    isUnreachable: derived.unreachable.has(nodeId),
    endingWithExits: isEnding && outgoing.length > 0,
  }
}

/** The lowest keypad digit not already used by a node's exits. */
export function nextFreeDigit(derived: DerivedGraph, nodeId: string): Digit | null {
  const used = new Set((derived.children.get(nodeId) ?? []).map((c) => c.digit))
  for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'] as Digit[]) {
    if (!used.has(d)) return d
  }
  return null
}
