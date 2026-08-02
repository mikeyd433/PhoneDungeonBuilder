import type { DerivedGraph, StoryGraph } from '@/types/domain'

/**
 * What actually happens in a room, read off the graph.
 *
 * Deliberately derived rather than stored as a `kind` column. A room "has
 * dialogue" precisely when it has dialogue lines; a stored flag could disagree
 * with the rows, and then two places would claim to be the truth. It also means
 * the 143 imported rooms answer correctly without a migration touching any of
 * them.
 *
 * These are not exclusive. A room can be a fight that also grants an item.
 */
export interface RoomKinds {
  /** Narration split into attributed lines — two actors can share the scene. */
  dialogue: boolean
  /** This room, or a door out of it, grants or revokes something, or is gated. */
  items: boolean
  fight: boolean
}

export function roomKinds(
  graph: StoryGraph,
  derived: DerivedGraph,
  nodeId: string,
): RoomKinds {
  const choiceIds = new Set((derived.children.get(nodeId) ?? []).map((c) => c.id))

  const dialogue = [...graph.dialogue.values()].some((l) => l.node_id === nodeId)

  // An item is "in play" here if arriving changes the satchel, if taking a door
  // changes it, or if a door checks it. A gate is as much a part of the item
  // story as the effect that grants the thing it asks for.
  const items =
    [...graph.effects.values()].some(
      (e) => e.node_id === nodeId || (e.choice_id !== null && choiceIds.has(e.choice_id)),
    ) || [...graph.gates.values()].some((g) => choiceIds.has(g.choice_id))

  const fight = [...graph.fights.values()].some((f) => f.node_id === nodeId)

  return { dialogue, items, fight }
}

/** Nothing special: the caller hears the room and picks a door. */
export function isPlainRoom(kinds: RoomKinds): boolean {
  return !kinds.dialogue && !kinds.items && !kinds.fight
}
