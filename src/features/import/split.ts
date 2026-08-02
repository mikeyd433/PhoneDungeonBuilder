import type { BrainstormExport } from './brainstorm'
import { choiceDigitOf } from './brainstorm'

/**
 * Splitting one flowchart into several stories.
 *
 * A single Brainstorm graph can hold more than one thing. This one opens with a
 * phone menu — "To stream our music, press 1" — and only becomes the dungeon
 * once the caller picks a character. Those are different works with different
 * lifecycles: the menu is largely built and recorded already, the dungeon is
 * being written.
 *
 * The split is defined by a **cut node**: that node and everything reachable
 * from it become the second story, and whatever is left becomes the first.
 * Edges crossing the boundary are not discarded — they become bricked archways
 * carrying the name of the room they used to reach, so the handoff is visible in
 * the ledger rather than silently gone.
 */

export interface SplitSuggestion {
  /** Node id the second story starts at. */
  cutId: string
  /** Slug prefix that dominates the first story, e.g. HOTLINE. */
  leadingPrefix: string | null
  upstream: Set<string>
  downstream: Set<string>
  /** Edges that cross from the first story into the second. */
  crossings: Array<{ fromId: string; toId: string }>
}

const prefixOf = (slug: string): string | null => {
  const m = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*?)_\d+$/.exec(slug)
  return m ? m[1] : null
}

/** Slug prefixes present in the graph's hand-written details, with counts. */
export function slugPrefixes(data: BrainstormExport): Array<{ prefix: string; count: number }> {
  const counts = new Map<string, number>()
  for (const n of data.nodes) {
    const details = (n.data?.details ?? '').trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(details)) continue
    const p = prefixOf(details)
    if (!p) continue
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  return [...counts]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count)
}

/** Everything reachable from a set of starting nodes. */
function reachableFrom(data: BrainstormExport, starts: string[]): Set<string> {
  const outgoing = new Map<string, string[]>()
  for (const e of data.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
  }
  const seen = new Set<string>(starts)
  const queue = [...starts]
  while (queue.length) {
    for (const next of outgoing.get(queue.shift()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

/**
 * Split the graph at one node: it and everything reachable from it become the
 * second story.
 *
 * The cut node joins the SECOND story, not the first. The handoff here is the
 * character choice, and picking Mike or Carter sends the caller somewhere
 * immediately different — that is the dungeon's first real decision, so it
 * belongs at the dungeon's entrance rather than tacked onto the end of a menu.
 *
 * Reachability is computed from the cut node first, so a room both sides can
 * reach belongs to the second. Giving it to the first would leave holes in the
 * dungeon.
 */
export function splitAt(data: BrainstormExport, cutId: string): SplitSuggestion {
  const downstream = reachableFrom(data, [cutId])
  const upstream = new Set<string>()
  for (const n of data.nodes) if (!downstream.has(n.id)) upstream.add(n.id)

  const crossings: Array<{ fromId: string; toId: string }> = []
  for (const e of data.edges) {
    if (upstream.has(e.source) && downstream.has(e.target)) {
      crossings.push({ fromId: e.source, toId: e.target })
    }
  }

  const cutNode = data.nodes.find((n) => n.id === cutId)
  return {
    cutId,
    leadingPrefix: prefixOf((cutNode?.data?.details ?? '').trim()),
    upstream,
    downstream,
    crossings,
  }
}

/**
 * Guess where the graph stops being one thing and becomes another.
 *
 * Looks for an edge between two *named* sections — a node whose details say
 * HOTLINE_9 leading to one that says CARTER_INTRO_0. Named sections are the
 * only reliable signal: in the real graph only 32 of 277 nodes carry a slug,
 * so "anything without the leading prefix" matches almost everything and cuts
 * the story in the wrong place.
 *
 * The split is taken *at* the handoff room, so that room becomes the second
 * story's entrance. In this story that room is the character choice, and the
 * two characters immediately lead somewhere different — so it belongs to the
 * dungeon as its first decision, not to the menu as an afterthought.
 *
 * Returns null when there is no such transition, which is the common case:
 * most flowcharts are one story and must be left alone.
 */
export function suggestSplit(data: BrainstormExport): SplitSuggestion | null {
  if (slugPrefixes(data).length < 2) return null

  const detailsOf = new Map(data.nodes.map((n) => [n.id, (n.data?.details ?? '').trim()]))
  const labelOf = new Map(data.nodes.map((n) => [n.id, n.data?.label ?? '']))
  const outgoing = new Map<string, string[]>()
  for (const e of data.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
  }

  // Which section does the caller start in? Prefer the prefix on a node nothing
  // leads into; the first story is the one containing the entrance.
  const inbound = new Set(data.edges.map((e) => e.target))
  const rootPrefix = data.nodes
    .filter((n) => !inbound.has(n.id))
    .map((n) => prefixOf(detailsOf.get(n.id) ?? ''))
    .find(Boolean)

  const transitions: Array<{ fromId: string; fromPrefix: string; toPrefix: string }> = []
  for (const n of data.nodes) {
    const from = prefixOf(detailsOf.get(n.id) ?? '')
    if (!from) continue
    for (const first of outgoing.get(n.id) ?? []) {
      const hops = choiceDigitOf(labelOf.get(first) ?? '')
        ? (outgoing.get(first) ?? [])
        : [first]
      for (const target of hops) {
        const to = prefixOf(detailsOf.get(target) ?? '')
        if (to && to !== from) transitions.push({ fromId: n.id, fromPrefix: from, toPrefix: to })
      }
    }
  }
  if (transitions.length === 0) return null

  // A transition out of the entrance's own section is the handoff we want.
  const handoff =
    transitions.find((t) => t.fromPrefix === rootPrefix) ?? transitions[0]
  const split = splitAt(data, handoff.fromId)

  // A split leaving almost nothing on one side is not a split.
  if (split.upstream.size < 2 || split.downstream.size < 2) return null
  return split
}
