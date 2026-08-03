import type { DerivedGraph, StoryGraph } from '@/types/domain'
import { graphEdges } from '@/features/graph/edges'

/**
 * Pointing a door at a room that already exists.
 *
 * The destination picker was every room in the story, alphabetically. At 139
 * rooms that is a list nobody can find anything in — and the thing authors
 * actually want from it is narrow and predictable: send this door BACK, to the
 * hub they keep returning to, or to somewhere they just walked through.
 *
 * So the candidates are ordered by how likely they are rather than by name:
 * the way you came first, then where you have been, then everything else
 * behind a search. Same operation either way — it only sets `to_node_id` — but
 * the first two groups are the ones that make a loop.
 */

export interface LoopCandidate {
  id: string
  title: string
  slug: string
  depth: number | null
  /**
   * True when wiring this door would make a back-edge: the target is an
   * ancestor of the room the door leaves, so the caller can come round again.
   * That is what draws as a stairwell rather than a door (F1.6), and it is the
   * shape "loop back" means.
   */
  loops: boolean
}

export interface LoopGroups {
  /** The rooms between the entrance and here, nearest first. */
  wayHere: LoopCandidate[]
  /** Rooms walked through this session, most recent first, minus `wayHere`. */
  visited: LoopCandidate[]
  /** Everything else, by name — reachable through the search box. */
  rest: LoopCandidate[]
}

/**
 * Ancestors of a room, nearest first.
 *
 * BFS from the entrance keeping a predecessor for each room, then walked back.
 * `derived.depth` is already a BFS but it does not keep the path, and the path
 * is the whole point here: those are the rooms a loop can return to.
 */
export function wayTo(graph: StoryGraph, nodeId: string): string[] {
  const root = graph.story.root_node_id
  if (!root) return []

  const from = new Map<string, string>()
  const seen = new Set([root])
  const queue = [root]
  const out = new Map<string, string[]>()
  for (const edge of graphEdges(graph)) {
    if (!edge.to_node_id) continue
    const list = out.get(edge.from_node_id) ?? []
    list.push(edge.to_node_id)
    out.set(edge.from_node_id, list)
  }

  while (queue.length > 0) {
    const at = queue.shift()!
    if (at === nodeId) break
    for (const next of out.get(at) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      from.set(next, at)
      queue.push(next)
    }
  }

  // Unreachable from the entrance: there is no "way here" to offer.
  if (nodeId !== root && !from.has(nodeId)) return []

  // Walk back to the entrance. The room we started from is not its own
  // ancestor, so the chain begins at its predecessor.
  const path: string[] = []
  let at = from.get(nodeId)
  while (at !== undefined) {
    path.push(at)
    at = from.get(at)
  }
  return path
}

export function loopTargets(
  graph: StoryGraph,
  derived: DerivedGraph,
  fromNodeId: string,
  trail: string[],
): LoopGroups {
  const ancestors = wayTo(graph, fromNodeId)
  const ancestorSet = new Set(ancestors)

  const toCandidate = (id: string): LoopCandidate | null => {
    const node = graph.nodes.get(id)
    if (!node) return null
    return {
      id,
      title: node.title?.trim() || node.slug,
      slug: node.slug,
      depth: derived.depth.get(id) ?? null,
      loops: ancestorSet.has(id) || id === fromNodeId,
    }
  }
  const keep = (list: (LoopCandidate | null)[]) => list.filter((c): c is LoopCandidate => Boolean(c))

  const wayHere = keep(ancestors.map(toCandidate))

  const visitedIds = [...trail]
    .reverse()
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => id !== fromNodeId && !ancestorSet.has(id))
  const visited = keep(visitedIds.map(toCandidate))

  const spoken = new Set([fromNodeId, ...ancestorSet, ...visitedIds])
  const rest = keep(
    [...graph.nodes.values()]
      .filter((n) => !spoken.has(n.id))
      .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))
      .map((n) => n.id)
      .map(toCandidate),
  )

  return { wayHere, visited, rest }
}

/** Narrow a group by what was typed. Name or slug — a room is findable by
 *  either, and after an import the slug is often all you remember. */
export function matchCandidates(list: LoopCandidate[], query: string): LoopCandidate[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return list
  return list.filter(
    (c) => c.title.toLowerCase().includes(needle) || c.slug.toLowerCase().includes(needle),
  )
}
