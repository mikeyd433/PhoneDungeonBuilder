import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { DerivedGraph, StoryGraph } from '@/types/domain'
import { graphEdges } from '@/features/graph/edges'
import { isFullyRecorded, linesOf } from '@/features/cast/dialogue'

/**
 * Automap layout (F4.1).
 *
 * Position is derived and never stored — §0's second rule. Dragging is what made
 * the flowchart clunky, so nothing here accepts a coordinate from the user, and
 * there is no persistence of x/y anywhere in the app.
 *
 * elkjs' layered algorithm rather than dagre, because this graph is full of
 * back-edges (a dungeon loops) and layered handles them without the tangle dagre
 * produces.
 */

export const ROOM_W = 96
export const ROOM_H = 56

export interface MapRoom {
  id: string
  slug: string
  /** What the author calls it. The slug is an identifier; on a map of 139
   *  rooms, PRESS_1_TO_TURN is not how anybody finds "helmet". */
  title: string
  x: number
  y: number
  w: number
  h: number
  written: boolean
  recorded: boolean
  isEnding: boolean
  isOrphan: boolean
  isUnreachable: boolean
  depth: number | null
  /** A fight room. Marked with crossed blades rather than a door count. */
  isFight: boolean
  /** Doors out, and how many of them lead nowhere yet. */
  doors: number
  looseDoors: number
  /** Nothing written here at all — neither narration nor lines. */
  isStub: boolean
}

export interface MapEdge {
  id: string
  from: string
  to: string
  /** Back-edge — drawn dashed, the way a portal is drawn as a stairwell. */
  isPortal: boolean
  /** A fight outcome rather than a door. Won and lost are drawn differently
   *  from each other, because which one a line is matters more here than
   *  anywhere else on the map. */
  outcome: 'win' | 'lose' | null
  points: Array<{ x: number; y: number }>
}

/** An unwritten branch: a short stub corridor ending in a question mark. */
export interface MapStub {
  id: string
  fromId: string
  digit: string
  x: number
  y: number
}

export interface MapLayout {
  rooms: MapRoom[]
  edges: MapEdge[]
  stubs: MapStub[]
  width: number
  height: number
}

/**
 * elkjs is fetched the first time a map is laid out, not on page load.
 *
 * It is by far the largest thing this app depends on — bundled eagerly it took
 * the whole app past 2 MB, which is both a slow first room on a phone and, more
 * bluntly, over the service worker's precache ceiling, so the build refused to
 * finish. Nothing needs a layout until something draws a map.
 *
 * The promise is kept, not the instance: two rooms mounting at once must not
 * start two downloads of the same megabyte.
 */
let elkPromise: Promise<{ layout: (g: ElkNode) => Promise<ElkNode> }> | null = null
const getElk = () => {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then((m) => new m.default())
  }
  return elkPromise
}

export async function layoutAutomap(
  graph: StoryGraph,
  derived: DerivedGraph,
): Promise<MapLayout> {
  const nodes = [...graph.nodes.values()]

  const children: ElkNode[] = nodes.map((n) => ({
    id: n.id,
    width: ROOM_W,
    height: ROOM_H,
  }))

  // Fight outcomes are laid out alongside doors: the room you land in after
  // winning belongs on the map in its real place, not floating.
  const allEdges = graphEdges(graph)
  const kindOf = new Map(allEdges.map((e) => [e.id, e.kind]))
  const edges: ElkExtendedEdge[] = allEdges
    .filter((e) => e.to_node_id)
    .map((e) => ({
      id: e.id,
      sources: [e.from_node_id],
      targets: [e.to_node_id!],
    }))

  const elk = await getElk()
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      // Top-down by story depth, so the entrance is at the top and descending
      // the map means descending the dungeon.
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '56',
      'elk.spacing.nodeNode': '32',
      'elk.edgeRouting': 'ORTHOGONAL',
      // Keep back-edges from dragging their source to the bottom of the map.
      'elk.layered.cycleBreaking.strategy': 'GREEDY',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    },
    children,
    edges,
  })

  const placed = new Map<string, ElkNode>()
  for (const child of result.children ?? []) placed.set(child.id, child)

  const fightNodes = new Set([...graph.fights.values()].map((f) => f.node_id))

  const rooms: MapRoom[] = nodes.map((n) => {
    const p = placed.get(n.id)
    const outgoing = derived.children.get(n.id) ?? []
    const hasWords = n.narration.trim().length > 0 || linesOf(graph, { nodeId: n.id }).length > 0
    return {
      id: n.id,
      slug: n.slug,
      title: n.title?.trim() || '',
      x: p?.x ?? 0,
      y: p?.y ?? 0,
      w: ROOM_W,
      h: ROOM_H,
      // "Written" means there is something for a caller to hear.
      written: n.narration.trim().length > 0,
      // Same rule as the torch: a room built from line takes is recorded when
      // every line has one.
      recorded: isFullyRecorded(graph, n.id),
      isEnding: n.node_type === 'ending',
      isOrphan: derived.orphans.has(n.id),
      isUnreachable: derived.unreachable.has(n.id),
      depth: derived.depth.get(n.id) ?? null,
      isFight: fightNodes.has(n.id),
      doors: outgoing.length,
      looseDoors: outgoing.filter((c) => !c.to_node_id).length,
      isStub: !hasWords,
    }
  })

  const laidOutEdges: MapEdge[] = (result.edges ?? []).map((e) => {
    const section = e.sections?.[0]
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : []
    const edge = e as ElkExtendedEdge
    const kind = kindOf.get(e.id)
    return {
      id: e.id,
      from: edge.sources[0],
      to: edge.targets[0],
      isPortal: derived.portals.has(e.id),
      outcome: kind === 'fight-win' ? 'win' : kind === 'fight-lose' ? 'lose' : null,
      points,
    }
  })

  // Unwritten branches get a stub hanging off the bottom of their source room.
  // Spread across the room's width so three unwritten exits don't stack.
  const stubs: MapStub[] = []
  const byNode = new Map<string, number>()
  for (const choice of graph.choices.values()) {
    if (choice.to_node_id) continue
    const room = rooms.find((r) => r.id === choice.from_node_id)
    if (!room) continue
    const n = byNode.get(room.id) ?? 0
    byNode.set(room.id, n + 1)
    stubs.push({
      id: choice.id,
      fromId: room.id,
      digit: choice.digit,
      x: room.x + 18 + n * 30,
      y: room.y + room.h + 24,
    })
  }

  return {
    rooms,
    edges: laidOutEdges,
    stubs,
    width: Math.max(result.width ?? 0, 1),
    height: Math.max(result.height ?? 0, 1),
  }
}
