import { DIGITS, type Digit } from '@/types/domain'
import { slugify, uniqueSlug } from '@/lib/slug'
import type { ImportIssue, ImportPlan, PlannedChoice, PlannedNode } from './buildImport'

/**
 * Import a Brainstorm (React Flow) graph export.
 *
 * Spec §8 recommends importing the spreadsheet rather than the flowchart, on the
 * grounds that "the React Flow export is mostly labels and canvas positions you
 * no longer need". That reasoning assumed the sheet held the real story. It
 * doesn't — CYOA_Node_Tracker.xlsx still contains only its example row — so the
 * flowchart is where the story actually lives, and this path exists.
 *
 * It is also a structurally better source than a sheet in one respect: edges are
 * explicit source/target id pairs, so no destination name has to be resolved by
 * guessing. What it lacks is everything the sheet has columns for — items,
 * recorded status, audio filenames — which is why §8 preferred the sheet and why
 * those still have to be filled in afterwards.
 *
 * Positions are read and discarded. §0's second rule: layout is derived, never
 * stored.
 */

interface RFNode {
  id: string
  type?: string
  data?: { label?: string; details?: string; color?: string }
}

interface RFEdge {
  id?: string
  source: string
  target: string
  data?: { label?: string }
  label?: string
}

export interface BrainstormExport {
  nodes: RFNode[]
  edges: RFEdge[]
}

/** Colours that read as an ending. Overridable from the preview screen. */
export const DEFAULT_ENDING_COLORS = ['red', 'rose']

export function isBrainstormExport(value: unknown): value is BrainstormExport {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<BrainstormExport>
  return (
    Array.isArray(v.nodes) &&
    Array.isArray(v.edges) &&
    v.nodes.every((n) => typeof n?.id === 'string') &&
    v.edges.every((e) => typeof e?.source === 'string' && typeof e?.target === 'string')
  )
}

/** Every colour actually used, so the preview can offer only real choices. */
export function colorsUsed(data: BrainstormExport): string[] {
  const seen = new Set<string>()
  for (const n of data.nodes) {
    if (n.type === 'stub') continue
    seen.add(n.data?.color || 'default')
  }
  return [...seen].sort()
}

export function buildBrainstormPlan(
  data: BrainstormExport,
  endingColors: string[] = DEFAULT_ENDING_COLORS,
): ImportPlan {
  const issues: ImportIssue[] = []
  const endings = new Set(endingColors)

  // `stub` nodes are routing waypoints for edge geometry, not rooms. Importing
  // them would fill the dungeon with empty rooms nobody wrote, so they are
  // skipped and any edge routed through them is bridged to the real node on the
  // far side.
  const isStub = (n: RFNode) => n.type === 'stub'
  const realNodes = data.nodes.filter((n) => !isStub(n))
  const byId = new Map(data.nodes.map((n) => [n.id, n]))

  const outgoing = new Map<string, RFEdge[]>()
  for (const e of data.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e)
  }

  // ---- rooms
  const nodes: PlannedNode[] = []
  const slugById = new Map<string, string>()
  const taken: string[] = []

  realNodes.forEach((n, i) => {
    const label = (n.data?.label ?? '').trim()
    const desired = slugify(label || `ROOM_${i + 1}`)
    const slug = uniqueSlug(desired, taken)
    if (slug !== desired) {
      issues.push({
        severity: 'warning',
        row: null,
        message: `Two nodes are both called "${label}" — the second imported as ${slug}.`,
      })
    }
    taken.push(slug)
    slugById.set(n.id, slug)

    const color = n.data?.color || 'default'
    nodes.push({
      slug,
      title: label || slug,
      // Brainstorm's "details" is the only free-text field on a node, so it is
      // the closest thing to narration. Where a node has none, the label is all
      // there is, and it becomes the title with nothing for the caller to hear.
      narration: (n.data?.details ?? '').trim(),
      node_type: endings.has(color) ? 'ending' : 'room',
      notes: null,
      recorded: false,
      sourceRow: i + 1,
    })
  })

  /**
   * Follow an edge to the first real node beyond any run of stubs.
   *
   * Returns every real node reachable through stubs, because a stub can fan out
   * to more than one destination. The visited set is what stops a stub loop —
   * a waypoint chain that circles back — from recursing forever.
   */
  const resolveThroughStubs = (startId: string, visited = new Set<string>()): string[] => {
    const node = byId.get(startId)
    if (!node) return []
    if (!isStub(node)) return [startId]
    if (visited.has(startId)) return []
    visited.add(startId)
    const out: string[] = []
    for (const e of outgoing.get(startId) ?? []) {
      out.push(...resolveThroughStubs(e.target, visited))
    }
    return out
  }

  // ---- exits
  const choices: PlannedChoice[] = []
  for (const n of realNodes) {
    const fromSlug = slugById.get(n.id)!
    const edges = outgoing.get(n.id) ?? []
    const targets: Array<{ slug: string | null; label: string }> = []

    for (const e of edges) {
      const label = (e.data?.label ?? e.label ?? '').trim()
      const resolved = resolveThroughStubs(e.target)
      if (resolved.length === 0) {
        // An edge into a stub that leads nowhere is a branch someone started
        // drawing and never finished — exactly a bricked archway.
        targets.push({ slug: null, label })
        issues.push({
          severity: 'warning',
          row: null,
          message: `${fromSlug} has an exit that leads only to a waypoint with nothing beyond it — imported as an unwritten branch.`,
        })
        continue
      }
      for (const id of resolved) {
        targets.push({ slug: slugById.get(id) ?? null, label })
      }
    }

    if (targets.length > DIGITS.length) {
      issues.push({
        severity: 'error',
        row: null,
        message: `${fromSlug} has ${targets.length} exits; a phone keypad has only ${DIGITS.length} digits. The extras are dropped.`,
      })
    }

    targets.slice(0, DIGITS.length).forEach((t, idx) => {
      choices.push({
        fromSlug,
        digit: DIGITS[idx] as Digit,
        // An unlabelled edge gives the caller nothing to be told. The
        // destination's name is a better placeholder than an empty prompt, and
        // it is obvious in the editor which ones still need writing.
        label: t.label || (t.slug ? `Go to ${t.slug}` : ''),
        toSlug: t.slug,
        ...(t.slug ? {} : { unresolvedName: t.label || '(unfinished branch)' }),
      })
    })

    const node = nodes.find((x) => x.slug === fromSlug)!
    if (node.node_type === 'ending' && targets.length > 0) {
      issues.push({
        severity: 'warning',
        row: null,
        message: `${fromSlug} is coloured as an ending but has exits — endings are read then hung up on, so those exits will never be offered.`,
      })
    }
  }

  // ---- the entrance: the node nothing leads into.
  const hasInbound = new Set(choices.map((c) => c.toSlug).filter(Boolean) as string[])
  const roots = nodes.filter((n) => !hasInbound.has(n.slug))
  const rootSlug = roots[0]?.slug ?? nodes[0]?.slug ?? null

  if (roots.length > 1) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `${roots.length} nodes have nothing leading into them (${roots
        .slice(0, 5)
        .map((r) => r.slug)
        .join(', ')}${roots.length > 5 ? '…' : ''}). ${rootSlug} was taken as the entrance; the rest import as sealed rooms.`,
    })
  }
  if (roots.length === 0 && nodes.length > 0) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `Every node has something leading into it, so there is no obvious entrance. ${rootSlug} was used — set the right one afterwards.`,
    })
  }

  if (nodes.length === 0) {
    issues.push({ severity: 'error', row: null, message: 'This file has no nodes in it.' })
  }

  const bare = nodes.filter((n) => !n.narration).length
  if (bare > 0) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `${bare} node(s) have no details text, so they import with a title but nothing for the caller to hear. Brainstorm keeps dialogue in a node's details.`,
    })
  }

  return {
    nodes,
    choices,
    // A flowchart carries no item data at all — that is the one real thing the
    // spreadsheet had over it, and it has to be added in the app afterwards.
    stateVars: [],
    effects: [],
    rootSlug,
    issues,
  }
}
