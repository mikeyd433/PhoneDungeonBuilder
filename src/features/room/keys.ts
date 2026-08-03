import type { Choice, StoryGraph } from '@/types/domain'
import { doorShows, variantsOf } from './variants'

/**
 * What one key means, when it can mean more than one thing.
 *
 * A room with readings has a wall per state, so "press 2" is allowed to be a
 * different door in each of them — different words, different destination —
 * as long as no single caller is ever offered both. The database used to forbid
 * this outright with `unique (from_node_id, digit)`; 0019 dropped that, because
 * whether two doors collide depends on the `hidden_doors` rows pointing at them
 * and on which readings exist, which is not a thing an index can know.
 *
 * So the rule lives here, and it is checked rather than prevented: the room
 * marks a clash, the ledger lists it and the export says so. The failure being
 * guarded is concrete — two `Digits equals 2` transitions off one split, where
 * Studio takes the first and the second door is simply never reachable.
 */

/** Every reading slot a caller can arrive in, base first. */
export function stateSlots(graph: StoryGraph, nodeId: string): Array<string | null> {
  return [null, ...variantsOf(graph, nodeId).map((v) => v.id)]
}

/** The doors of a room, grouped by the key that reaches them. */
export function doorsByDigit(graph: StoryGraph, nodeId: string): Map<string, Choice[]> {
  const out = new Map<string, Choice[]>()
  const doors = [...graph.choices.values()]
    .filter((c) => c.from_node_id === nodeId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  for (const door of doors) {
    const list = out.get(door.digit) ?? []
    list.push(door)
    out.set(door.digit, list)
  }
  return out
}

/**
 * Which door a key opens for a caller in one state, or null for no door at all.
 *
 * First visible one wins by `sort_order`, deterministically — a clash is a
 * story bug rather than a coin toss, and the exporter has to emit *something*.
 * `keyConflicts` is what tells the author it happened.
 */
export function doorForKey(
  graph: StoryGraph,
  nodeId: string,
  digit: string,
  slot: string | null,
): Choice | null {
  const doors = doorsByDigit(graph, nodeId).get(digit) ?? []
  return doors.find((d) => doorShows(graph, d.id, slot)) ?? null
}

export interface KeyConflict {
  digit: string
  /** The reading slot both are offered in. Null is the room as written. */
  slot: string | null
  choiceIds: string[]
}

/**
 * Keys that open two doors at once.
 *
 * Only ever within ONE state: two doors on digit 2, one shown as written and
 * one shown with the crowbar, is the whole point of this feature and not a
 * problem. Both shown to the same caller is.
 */
export function keyConflicts(graph: StoryGraph, nodeId: string): KeyConflict[] {
  const out: KeyConflict[] = []
  const slots = stateSlots(graph, nodeId)
  for (const [digit, doors] of doorsByDigit(graph, nodeId)) {
    if (doors.length < 2) continue
    for (const slot of slots) {
      const visible = doors.filter((d) => doorShows(graph, d.id, slot))
      if (visible.length > 1) {
        out.push({ digit, slot, choiceIds: visible.map((d) => d.id) })
      }
    }
  }
  return out
}

/** True when this room has more than one door on any one key. */
export function hasSharedKeys(graph: StoryGraph, nodeId: string): boolean {
  for (const doors of doorsByDigit(graph, nodeId).values()) {
    if (doors.length > 1) return true
  }
  return false
}

/**
 * The rows a new door needs so it does not collide with the one already on its
 * key.
 *
 * Making a second door on digit 2 while standing in "Has crowbar" means: this
 * door is for THAT state. Everywhere else keeps the door it already had, so the
 * new one is hidden in every other slot. Returns the slots to hide it in —
 * empty when the digit was free, which is the ordinary case and must stay
 * "visible everywhere, no rows".
 */
export function slotsToHideNewDoor(
  graph: StoryGraph,
  nodeId: string,
  digit: string,
  madeIn: string | null | 'all',
): Array<string | null> {
  const taken = doorsByDigit(graph, nodeId).get(digit) ?? []
  if (taken.length === 0) return []
  // Made in the authoring view, with no one state in mind: hide it nowhere and
  // let `keyConflicts` say so, rather than guessing which state it was for.
  if (madeIn === 'all') return []
  return stateSlots(graph, nodeId).filter((slot) => slot !== madeIn)
}
