import type { DerivedGraph, StoryGraph } from '@/types/domain'
import type { AudioTarget } from './targets'

/**
 * The order you actually record in.
 *
 * `audioTargets` lists every slot alphabetically by slug, which is right for a
 * manifest you scan and wrong for a session you work through: an actor reads a
 * story front to back, and jumping between act three and the prologue every
 * other take is how a performance loses its thread.
 *
 * So: breadth-first depth from the entrance, then slug to break ties, then the
 * slot's own order within a room — its lines before its fight rounds before the
 * reactions on its doors. Anything with no room behind it (the inventory
 * lead-in, an item's name) sorts to the end, because those are read flat and
 * belong in one short sitting rather than scattered through the story.
 */

/** Which room a slot is heard in, if any. */
export function roomOf(graph: StoryGraph, target: AudioTarget): string | null {
  const ref = target.ref
  switch (ref.kind) {
    case 'room':
      return ref.nodeId
    case 'line':
      return lineRoom(graph, ref.lineId)
    case 'fight round': {
      const round = graph.fightRounds.get(ref.roundId)
      return round ? (graph.fights.get(round.fight_id)?.node_id ?? null) : null
    }
    case 'reaction':
    case 'refusal':
      return graph.choices.get(ref.choiceId)?.from_node_id ?? null
    default:
      return null
  }
}

/** A line lives on a room, or on a door — and a door is heard where it leaves. */
function lineRoom(graph: StoryGraph, lineId: string): string | null {
  const line = graph.dialogue.get(lineId)
  if (!line) return null
  if (line.node_id) return line.node_id
  return line.choice_id ? (graph.choices.get(line.choice_id)?.from_node_id ?? null) : null
}

/** Within one room: what is heard first, first. */
const WITHIN_ROOM: Record<AudioTarget['ref']['kind'], number> = {
  room: 0,
  line: 0,
  // Straight after the room it replaces: an actor reads the version and then
  // its alternates while the scene is still in their head.
  'fight round': 1,
  refusal: 2,
  reaction: 3,
  // Both live outside any one room, so they sort to the end together —
  // an actor records the story, then the handful of things it says about
  // objects wherever they turn up.
  item: 9,
  'item moment': 9,
  inventory: 9,
}

export function inStoryOrder(
  targets: AudioTarget[],
  graph: StoryGraph,
  derived: DerivedGraph,
): AudioTarget[] {
  // The last tiebreak is the order `audioTargets` emitted them in, not the key:
  // that order is already deliberate (the inventory lead-in before the empty
  // handed one, items alphabetically), and alphabetising keys would undo it.
  const source = new Map(targets.map((t, i) => [t.key, i]))
  const rank = (t: AudioTarget) => {
    const roomId = roomOf(graph, t)
    const node = roomId ? graph.nodes.get(roomId) : null
    // A room the entrance cannot reach still has to be recordable, so it sorts
    // to the back rather than being dropped or crashing the comparison.
    const depth = roomId ? (derived.depth.get(roomId) ?? Number.MAX_SAFE_INTEGER) : null
    return {
      flat: node ? 0 : 1,
      depth: depth ?? 0,
      slug: node?.slug ?? '',
      within: WITHIN_ROOM[t.ref.kind],
      source: source.get(t.key) ?? 0,
    }
  }

  return [...targets].sort((a, b) => {
    const x = rank(a)
    const y = rank(b)
    return (
      x.flat - y.flat ||
      x.depth - y.depth ||
      x.slug.localeCompare(y.slug) ||
      x.within - y.within ||
      x.source - y.source
    )
  })
}

export interface QueueProgress {
  done: number
  total: number
  /** Seconds of finished audio, for "how long is this thing". */
  recordedMs: number
}

export function progressOf(targets: AudioTarget[]): QueueProgress {
  let done = 0
  let recordedMs = 0
  for (const t of targets) {
    if (!t.currentPath) continue
    done += 1
    recordedMs += t.currentDurationMs ?? 0
  }
  return { done, total: targets.length, recordedMs }
}
