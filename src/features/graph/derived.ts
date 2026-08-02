import type { Choice, DerivedGraph, GraphEdge, StoryGraph } from '@/types/domain'
import { DIGITS } from '@/types/domain'
import { graphEdges } from './edges'
import { isFullyRecorded } from '@/features/cast/dialogue'

const digitOrder = new Map(DIGITS.map((d, i) => [d as string, i]))

/**
 * Exits are ordered by the key the caller presses. Nothing else.
 *
 * This compared `sort_order` first, which meant the wall position was fixed at
 * import and never moved again: changing a door's digit from 2 to 1 renumbered
 * the lintel and left the door where it was, so a room could read 2 · 1 · 3.
 * There is no separate ordering to preserve — this app has no dragging, and on
 * a phone the digit *is* the order.
 *
 * `sort_order` still breaks ties, which is what keeps fight edges in place:
 * they carry no digit, so they all fall to the 99 bucket, behind every real
 * key, and 100/101/102 orders win before lose before the named move outcomes.
 */
function byDigit(a: { digit: string | null; sort_order: number }, b: { digit: string | null; sort_order: number }): number {
  const byKey = (digitOrder.get(a.digit ?? '') ?? 99) - (digitOrder.get(b.digit ?? '') ?? 99)
  return byKey !== 0 ? byKey : a.sort_order - b.sort_order
}

/**
 * Spec §2, "Derived, never stored". Everything structural is recomputed from the
 * node graph — nothing about layout or hierarchy is ever persisted, which is
 * what lets the automap auto-lay-out and keeps dragging out of the app entirely.
 */
export function deriveGraph(graph: StoryGraph): DerivedGraph {
  const parents = new Map<string, Choice[]>()
  const children = new Map<string, Choice[]>()
  const edgesFrom = new Map<string, GraphEdge[]>()
  const edgesTo = new Map<string, GraphEdge[]>()

  for (const node of graph.nodes.values()) {
    parents.set(node.id, [])
    children.set(node.id, [])
    edgesFrom.set(node.id, [])
    edgesTo.set(node.id, [])
  }

  for (const edge of graphEdges(graph)) {
    edgesFrom.get(edge.from_node_id)?.push(edge)
    if (edge.to_node_id) edgesTo.get(edge.to_node_id)?.push(edge)
    if (!edge.choice) continue
    children.get(edge.from_node_id)?.push(edge.choice)
    if (edge.to_node_id) parents.get(edge.to_node_id)?.push(edge.choice)
  }

  for (const list of children.values()) list.sort(byDigit)
  for (const list of edgesFrom.values()) list.sort(byDigit)

  const rootId = graph.story.root_node_id

  // Depth: BFS from root. Nodes never dequeued are unreachable (F4.8).
  const depth = new Map<string, number>()
  if (rootId && graph.nodes.has(rootId)) {
    const queue: string[] = [rootId]
    depth.set(rootId, 0)
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      const d = depth.get(id)!
      for (const edge of edgesFrom.get(id) ?? []) {
        const next = edge.to_node_id
        if (!next || depth.has(next)) continue
        depth.set(next, d + 1)
        queue.push(next)
      }
    }
  }

  const unreachable = new Set<string>()
  for (const id of graph.nodes.keys()) {
    if (!depth.has(id)) unreachable.add(id)
  }

  // Orphans: nothing leads here, and it isn't the root. A room reached only by
  // winning a fight has no inbound *choice*, but plenty leads to it.
  const orphans = new Set<string>()
  for (const [id, inbound] of edgesTo) {
    if (id !== rootId && inbound.length === 0) orphans.add(id)
  }

  // Portals: back-edges. An edge is a back-edge when its target is still open on
  // the DFS stack — i.e. the target is a genuine ancestor of the source, not
  // merely a node visited earlier down some other branch. That distinction is
  // why this is an explicit DFS with a colour map rather than a depth compare:
  // a cross-edge to a shallower node is reconvergence (a door), not a loop back
  // up the dungeon (a stairwell).
  const portals = new Set<string>()
  if (rootId && graph.nodes.has(rootId)) {
    const OPEN = 1
    const DONE = 2
    const state = new Map<string, number>()
    // Iterative DFS so a deep dungeon can't blow the JS stack.
    const stack: Array<{ id: string; next: number }> = [{ id: rootId, next: 0 }]
    state.set(rootId, OPEN)
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const outgoing = edgesFrom.get(frame.id) ?? []
      if (frame.next >= outgoing.length) {
        state.set(frame.id, DONE)
        stack.pop()
        continue
      }
      const edge = outgoing[frame.next++]
      const target = edge.to_node_id
      if (!target || !graph.nodes.has(target)) continue
      const seen = state.get(target)
      if (seen === OPEN) {
        portals.add(edge.id)
      } else if (seen === undefined) {
        state.set(target, OPEN)
        stack.push({ id: target, next: 0 })
      }
    }
  }

  return { depth, orphans, portals, unreachable, parents, children, edgesFrom, edgesTo }
}

/** Choices with no destination — the to-write list behind the ledger's
 *  "unexplored passages" tab (F4.3). */
export function unwrittenBranches(graph: StoryGraph): Choice[] {
  return [...graph.choices.values()].filter((c) => c.to_node_id === null)
}

/** Nodes still missing audio, shallowest first, so you record from the entrance
 *  outward (F4.5). Unreachable nodes sort last.
 *
 *  "Missing audio" means the same thing here as it does to the torch: a room
 *  assembled from line takes is done when every line has one, not when the room
 *  itself has a file it never plays. */
export function darkRooms(graph: StoryGraph, derived: DerivedGraph) {
  return [...graph.nodes.values()]
    .filter((n) => !isFullyRecorded(graph, n.id))
    .sort(
      (a, b) =>
        (derived.depth.get(a.id) ?? Infinity) - (derived.depth.get(b.id) ?? Infinity) ||
        a.slug.localeCompare(b.slug),
    )
}

/**
 * F4.9 — a cycle from which no ending is reachable. A caller who walks into one
 * can never finish the story, and on the phone that means they loop until
 * Studio's repeat guard hangs up on them (§6.0).
 *
 * Computed as: the set of nodes that cannot reach any `ending` node. Anything
 * reachable from the root but unable to reach an ending is a trap.
 */
export function trapNodes(graph: StoryGraph, derived: DerivedGraph): Set<string> {
  // Reverse BFS from every ending.
  const canFinish = new Set<string>()
  const queue: string[] = []
  for (const node of graph.nodes.values()) {
    if (node.node_type === 'ending') {
      canFinish.add(node.id)
      queue.push(node.id)
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const inbound of derived.edgesTo.get(queue[i]) ?? []) {
      if (!canFinish.has(inbound.from_node_id)) {
        canFinish.add(inbound.from_node_id)
        queue.push(inbound.from_node_id)
      }
    }
  }

  const traps = new Set<string>()
  for (const id of graph.nodes.keys()) {
    // Only flag reachable nodes; unreachable ones are already their own finding.
    if (!canFinish.has(id) && !derived.unreachable.has(id)) traps.add(id)
  }
  return traps
}
