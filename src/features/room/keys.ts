import type { Choice, StoryGraph } from '@/types/domain'

/**
 * Two doors on one key.
 *
 * `unique (from_node_id, digit)` was dropped in 0019, when a room could read
 * several ways and "press 2" was allowed to be a different door in each. That
 * went with the readings: a room has one wall now, so two doors on a key is a
 * story bug with nothing to disambiguate it — the export emits one transition
 * per digit, and two `Digits equals 2` off one split would have Studio silently
 * take the first.
 *
 * Still CHECKED rather than re-imposed as a constraint, because the rows can
 * already exist in a story written under 0019 and a rejected write is a worse
 * way to find that out than a marker on the door. Reported on the wall, in the
 * editor and in the export.
 */

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

export interface KeyConflict {
  digit: string
  choiceIds: string[]
}

/** Keys carrying more than one door. Only the first is ever reachable. */
export function keyConflicts(graph: StoryGraph, nodeId: string): KeyConflict[] {
  const out: KeyConflict[] = []
  for (const [digit, doors] of doorsByDigit(graph, nodeId)) {
    if (doors.length > 1) out.push({ digit, choiceIds: doors.map((d) => d.id) })
  }
  return out.sort((a, b) => a.digit.localeCompare(b.digit))
}
