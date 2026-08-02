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
import { buildFightView, type FightView } from '@/features/fight/model'
import { isFullyRecorded, linesFor, reactionPlaybackFor } from '@/features/cast/dialogue'

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
  /** False when `targetTitle` is only the slug standing in for a real name. */
  targetTitled: boolean
  /** Which wall: 0 = left, 1 = centre, 2 = right. */
  slot: number
  /** F1.7 — a chest at this door means the choice grants something. */
  grants: string[]
  /** A hole in the floor by this door means it revokes something. */
  revokes: string[]
  /** F1.8 — an iron portcullis. Null when the choice has no gate. */
  gate: { behavior: 'hide' | 'refuse' | 'divert'; conditionCount: number } | null
  /** What the caller hears between pressing this and arriving. `written` means
   *  a script with at least one part nobody has read — silence on the phone,
   *  and the reason this is three states rather than a boolean. */
  reaction: 'none' | 'written' | 'recorded'
}

export interface RoomView {
  node: StoryNode
  /** Up to three wall exits (§11.1). */
  exits: ExitView[]
  /** F1.13 — digits 4–9 render as a stacked list rather than walls. */
  overflowExits: ExitView[]
  /** F1.4 / F1.12 — every way in, fight outcomes included. More than one means a
   *  retreat chooser. */
  retreats: Array<{ edgeId: string; fromId: string; fromTitle: string }>
  /** F1.11 — rooms sharing a parent with this one, in digit order, including
   *  this room. Swiping the floor plaque cycles them, so a whole choice set can
   *  be reviewed without walking back up. */
  siblings: string[]
  /** F1.5 — lit when the room's audio is complete. Unfinished territory is
   *  literally dark. For a room recorded line by line, that means every line. */
  torchLit: boolean
  /** Which of the ten room designs this room is dressed in. */
  design: string
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
  /** Set when this room is a fight. The walls give way to the arena. */
  fight: FightView | null
  /** A fight room that also has doors: the doors are never offered, because the
   *  fight decides where the caller goes. */
  fightWithExits: boolean
  /** F1.14 — the narration, split by who says it. Empty when nobody has split
   *  this room's text into lines yet. */
  lines: Array<{ id: string; speaker: string | null; color: string; text: string }>
}

/**
 * What to call an item where the AUTHOR is reading, not the compiler.
 *
 * The slug is the identifier — it is what the exported Liquid tests against and
 * what a gate is written in terms of — but "a coil of rope" is what the room is
 * about. Falls back to the slug for a var that never got a name.
 */
function varName(graph: StoryGraph, effect: Effect): string {
  const v = graph.stateVars.get(effect.state_var_id)
  return v?.name?.trim() || v?.slug || '?'
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

/**
 * How far along a door's reaction is, in one word.
 *
 * Asked of `reactionPlaybackFor` rather than of the columns, because a reaction
 * split between two actors is recorded as its lines and the file on the door is
 * not what plays — reading `choice.audio_path` here would call a half-recorded
 * two-hander done.
 */
function reactionState(graph: StoryGraph, choiceId: string): 'none' | 'written' | 'recorded' {
  const parts = reactionPlaybackFor(graph, choiceId)
  if (parts.length === 0) return 'none'
  return parts.every((p) => p.audioPath) ? 'recorded' : 'written'
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
        grants.push(varName(graph, effect))
      } else {
        revokes.push(varName(graph, effect))
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
      // Falls back to the slug so a door never reads as leading nowhere, but
      // the two are different things: `titled` is what tells a renderer whether
      // it is showing a name somebody wrote or an identifier standing in.
      targetTitle: target?.title || target?.slug || null,
      targetTitled: Boolean(target?.title?.trim()),
      slot,
      grants,
      revokes,
      gate: gate
        ? { behavior: gate.fail_behavior, conditionCount: countConditions(gate.expression) }
        : null,
      reaction: reactionState(graph, choice.id),
    }
  }

  const exits: ExitView[] = outgoing.slice(0, WALL_EXITS).map(toExit)
  const overflowExits: ExitView[] = outgoing
    .slice(WALL_EXITS)
    .map((c, i) => toExit(c, WALL_EXITS + i))

  const fight = buildFightView(graph, nodeId)

  // Pad the walls out to three so empty slots render as bricked archways you can
  // chisel through — the primary way new rooms get made (F1.3). A fight room is
  // not padded: its way onward is won, not chosen, so offering a bricked arch
  // there would invite the author to build a door the caller never sees.
  const usedDigits = new Set(outgoing.map((c) => c.digit))
  const isEnding = node.node_type === 'ending'
  if (!isEnding && !fight) {
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
        targetTitled: false,
        slot: exits.length,
        grants: [],
        revokes: [],
        gate: null,
        reaction: 'none',
      })
      usedDigits.add(String(nextDigit) as Digit)
      nextDigit++
    }
  }
  exits.forEach((e, i) => (e.slot = i))

  const arrival = effectsFor((e) => e.node_id === nodeId)

  const retreats = (derived.edgesTo.get(nodeId) ?? []).map((e) => {
    const from = graph.nodes.get(e.from_node_id)
    return {
      edgeId: e.id,
      fromId: e.from_node_id,
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
    // F1.5 — the torch means "there is audio for this room", and for a room
    // assembled line by line that is only true once every line has a take. One
    // recorded line out of four is a scene with three silences in it, and
    // lighting it would be exactly the atmosphere-over-data §0 forbids.
    torchLit: isFullyRecorded(graph, nodeId),
    design: node.room_design || 'stone',
    isEnding,
    depth: derived.depth.get(nodeId) ?? null,
    arrivalGrants: arrival.grants,
    arrivalRevokes: arrival.revokes,
    isOrphan: derived.orphans.has(nodeId),
    isUnreachable: derived.unreachable.has(nodeId),
    endingWithExits: isEnding && outgoing.length > 0,
    fight,
    fightWithExits: Boolean(fight) && outgoing.length > 0,
    lines: linesFor(graph, nodeId).map((l) => {
      const character = l.character_id ? graph.characters.get(l.character_id) : null
      return {
        id: l.id,
        speaker: character?.name ?? null,
        // Unattributed lines take the parchment default, so the colour always
        // means "this particular person", never "this is dialogue".
        color: character?.color ?? 'parchment',
        text: l.text,
      }
    }),
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
