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

/**
 * A node whose label starts "1." / "2)" is a *choice*, not a room.
 *
 * Real flowcharts alternate: a prose node holding the dialogue, then one small
 * node per option, then the room each option leads to. Imported literally, every
 * one of those option nodes becomes a room containing the text "1.Follow her"
 * and the dungeon comes out twice as deep as it really is.
 */
const CHOICE_LABEL = /^\s*(\d)\s*[.)]\s*/

export function choiceDigitOf(label: string): string | null {
  const m = CHOICE_LABEL.exec(label ?? '')
  return m ? m[1] : null
}

export function stripChoicePrefix(label: string): string {
  return (label ?? '').replace(CHOICE_LABEL, '').trim()
}

/** How many nodes look like options — drives whether collapsing is offered. */
export function choiceNodeRatio(data: BrainstormExport): number {
  const real = data.nodes.filter((n) => n.type !== 'stub')
  if (real.length === 0) return 0
  const n = real.filter((x) => choiceDigitOf(x.data?.label ?? '')).length
  return n / real.length
}

/**
 * A slug the author already wrote, kept verbatim.
 *
 * Brainstorm has no slug field, so an author who wants stable ids puts them in
 * `details` — this graph has SHARKS_1, CARTER_INTRO_0 and so on. Those are worth
 * far more than a slug derived from 400 characters of dialogue, because they are
 * what the recorded audio filenames are already named after.
 */
function explicitSlug(details: string | undefined): string | null {
  const v = (details ?? '').trim()
  return /^[A-Z][A-Z0-9_]*$/.test(v) ? v : null
}

/** A short human title from a wall of dialogue. */
function titleFrom(label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim()
  if (clean.length <= 48) return clean
  const cut = clean.slice(0, 48)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/**
 * Derive a slug from the opening words of a line of dialogue.
 *
 * Kept to four words. A slug becomes the Twilio widget prefix
 * (`SLUG_play`, `SLUG_gather`) and the name audio files get saved under, so a
 * 48-character slug taken from half a sentence is unusable in both places.
 * Speaker names are dropped because half this story's lines open with
 * "Carter:" or "Mike:", which would otherwise make most slugs identical.
 */
const SPEAKER = /^\s*[A-Z][a-z]+\s*:\s*/
const FILLER = new Set(['the', 'a', 'an', 'and', 'you', 'your', 'of', 'to', 'is', 'it', 'in'])

function slugFromDialogue(label: string): string {
  const spoken = label.replace(SPEAKER, '').replace(/[*<>"]/g, ' ')
  const all = spoken.split(/[^A-Za-z0-9]+/).filter(Boolean)
  // Dropping a leading "the"/"you" makes for a better slug, but it must never
  // empty the name outright — a room labelled just "A" still needs a slug.
  const trimmed = all.filter((w, i) => i > 0 || !FILLER.has(w.toLowerCase()))
  const words = (trimmed.length > 0 ? trimmed : all).slice(0, 4)
  return slugify(words.join(' '))
}

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

export interface BrainstormOptions {
  endingColors?: string[]
  /**
   * Import only these nodes as rooms. Edges reaching anything outside the set
   * become bricked archways naming where they used to lead, so a handoff to a
   * sibling story stays visible in the ledger instead of vanishing.
   */
  restrictTo?: Set<string>
  /** What to call the other side of the boundary, in warnings and labels. */
  otherStoryName?: string
  /**
   * Collapse "1./2./3." nodes into the exits they represent instead of
   * importing them as rooms. On when the graph clearly uses that convention.
   */
  collapseChoiceNodes?: boolean
}

export function buildBrainstormPlan(
  data: BrainstormExport,
  options: BrainstormOptions | string[] = {},
): ImportPlan {
  // Tolerate the older positional signature (endingColors as an array).
  const opts: BrainstormOptions = Array.isArray(options)
    ? { endingColors: options }
    : options
  const endings = new Set(opts.endingColors ?? DEFAULT_ENDING_COLORS)
  const collapse = opts.collapseChoiceNodes ?? choiceNodeRatio(data) >= 0.25

  const issues: ImportIssue[] = []
  const isStub = (n: RFNode) => n.type === 'stub'
  const byId = new Map(data.nodes.map((n) => [n.id, n]))

  const outgoing = new Map<string, RFEdge[]>()
  for (const e of data.edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e)
  }

  const labelOf = (id: string) => byId.get(id)?.data?.label ?? ''
  const looksLikeChoice = (id: string) => {
    const n = byId.get(id)
    return Boolean(n && !isStub(n) && choiceDigitOf(n.data?.label ?? ''))
  }

  /**
   * Which option nodes can safely be folded into an edge.
   *
   * Only the unambiguous shape: at most one way onward, and not leading
   * straight into another option node. Anything stranger stays a room and is
   * reported, because guessing at it would quietly rewrite the story.
   */
  const collapsed = new Set<string>()
  if (collapse) {
    for (const n of data.nodes) {
      if (isStub(n) || !looksLikeChoice(n.id)) continue
      const out = outgoing.get(n.id) ?? []
      if (out.length > 1) continue
      if (out.length === 1 && looksLikeChoice(out[0].target)) continue
      collapsed.add(n.id)
    }
    const awkward = [...data.nodes].filter(
      (n) => !isStub(n) && looksLikeChoice(n.id) && !collapsed.has(n.id),
    )
    if (awkward.length > 0) {
      issues.push({
        severity: 'warning',
        row: null,
        message: `${awkward.length} option node(s) lead to more than one place, or to another option, so they were kept as rooms rather than guessed at: ${awkward
          .slice(0, 4)
          .map((n) => `"${titleFrom(n.data?.label ?? '')}"`)
          .join(', ')}${awkward.length > 4 ? '…' : ''}.`,
      })
    }
  }

  const inPartition = (id: string) => !opts.restrictTo || opts.restrictTo.has(id)
  const realNodes = data.nodes.filter(
    (n) => !isStub(n) && !collapsed.has(n.id) && inPartition(n.id),
  )

  // ---- rooms
  const nodes: PlannedNode[] = []
  const slugById = new Map<string, string>()
  const taken: string[] = []
  let explicitCount = 0

  realNodes.forEach((n, i) => {
    const label = (n.data?.label ?? '').trim()
    const written = explicitSlug(n.data?.details)
    if (written) explicitCount++
    const desired = written ?? (slugFromDialogue(label) || `ROOM_${i + 1}`)
    const slug = uniqueSlug(desired, taken)
    if (slug !== desired) {
      issues.push({
        severity: 'warning',
        row: null,
        message: `Two rooms both wanted the slug ${desired} — the second became ${slug}.`,
      })
    }
    taken.push(slug)
    slugById.set(n.id, slug)

    const color = n.data?.color || 'default'
    nodes.push({
      slug,
      // The label is the dialogue, so it is the narration. The title is a short
      // version of it, purely so the room is identifiable in a list.
      title: titleFrom(label),
      narration: label,
      node_type: endings.has(color) ? 'ending' : 'room',
      notes: null,
      recorded: false,
      sourceRow: i + 1,
    })
  })

  if (explicitCount > 0) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `${explicitCount} room(s) had a slug written in their details (SHARKS_1 and the like) and kept it. The other ${nodes.length - explicitCount} got a slug derived from their opening line — worth a look before you record anything against them.`,
    })
  }

  /** Follow an edge past any run of waypoint stubs to the real nodes beyond. */
  const throughStubs = (startId: string, visited = new Set<string>()): string[] => {
    const node = byId.get(startId)
    if (!node) return []
    if (!isStub(node)) return [startId]
    if (visited.has(startId)) return []
    visited.add(startId)
    return (outgoing.get(startId) ?? []).flatMap((e) => throughStubs(e.target, visited))
  }

  // ---- exits
  const crossings: string[] = []
  const nameOutside = (id: string) => {
    const n = byId.get(id)
    const written = explicitSlug(n?.data?.details)
    return written ?? titleFrom(n?.data?.label ?? 'elsewhere')
  }
  const choices: PlannedChoice[] = []
  for (const n of realNodes) {
    const fromSlug = slugById.get(n.id)!
    const wanted: Array<{
      slug: string | null
      label: string
      digit: string | null
      beyond?: string
    }> = []

    for (const e of outgoing.get(n.id) ?? []) {
      const reached = throughStubs(e.target)
      if (reached.length === 0) {
        // An edge into a waypoint that leads nowhere — or loops back on itself
        // — is a branch someone started drawing and never finished. That is a
        // bricked archway, not a missing exit.
        const stray = (e.data?.label ?? e.label ?? '').trim()
        wanted.push({ slug: null, label: stray, digit: null })
        issues.push({
          severity: 'warning',
          row: null,
          message: `${fromSlug} has an exit leading only to a waypoint with nothing beyond it — imported as an unwritten branch.`,
        })
        continue
      }
      for (const targetId of reached) {
        if (collapsed.has(targetId)) {
          // The option node IS the exit: its number is the keypad digit and its
          // text is what the caller is offered.
          const optLabel = labelOf(targetId)
          const onward = (outgoing.get(targetId) ?? []).flatMap((x) => throughStubs(x.target))
          const dest = onward.find((id) => slugById.has(id))
          const outside = !dest && onward.find((id) => !inPartition(id))
          if (outside) crossings.push(outside)
          wanted.push({
            slug: dest ? (slugById.get(dest) ?? null) : null,
            label: stripChoicePrefix(optLabel) || optLabel,
            digit: choiceDigitOf(optLabel),
            beyond: outside ? nameOutside(outside) : undefined,
          })
        } else {
          const known = slugById.get(targetId) ?? null
          if (!known && !inPartition(targetId)) crossings.push(targetId)
          wanted.push({
            slug: known,
            label: (e.data?.label ?? e.label ?? '').trim(),
            digit: null,
            beyond: !known && !inPartition(targetId) ? nameOutside(targetId) : undefined,
          })
        }
      }
    }

    if (wanted.length > DIGITS.length) {
      issues.push({
        severity: 'error',
        row: null,
        message: `${fromSlug} has ${wanted.length} exits; a phone keypad has only ${DIGITS.length} digits. The extras are dropped.`,
      })
    }

    // Honour the number the author wrote where it is free; fall back to the
    // next unused digit so two options numbered "1." cannot collide.
    const used = new Set<string>()
    const assign = (preferred: string | null): Digit | null => {
      if (preferred && !used.has(preferred) && (DIGITS as readonly string[]).includes(preferred)) {
        used.add(preferred)
        return preferred as Digit
      }
      for (const d of DIGITS) {
        if (!used.has(d)) {
          used.add(d)
          return d
        }
      }
      return null
    }

    for (const t of wanted.slice(0, DIGITS.length)) {
      const digit = assign(t.digit)
      if (!digit) break
      choices.push({
        fromSlug,
        digit,
        label: t.label || (t.slug ? `Go to ${t.slug}` : ''),
        toSlug: t.slug,
        ...(t.slug ? {} : { unresolvedName: t.beyond ?? t.label ?? '(unfinished branch)' }),
      })
    }

    const room = nodes.find((x) => x.slug === fromSlug)!
    if (room.node_type === 'ending' && wanted.length > 0) {
      issues.push({
        severity: 'warning',
        row: null,
        message: `${fromSlug} is coloured as an ending but has exits — endings are read then hung up on, so those exits will never be offered.`,
      })
    }
  }

  if (crossings.length > 0) {
    const where = opts.otherStoryName ? ` into "${opts.otherStoryName}"` : ' into the other story'
    issues.push({
      severity: 'warning',
      row: null,
      message: `${crossings.length} exit(s) lead${where} (${[...new Set(crossings.map(nameOutside))]
        .slice(0, 3)
        .join(', ')}). They import as bricked archways here — the two stories are wired together in Studio, not in the app.`,
    })
  }

  const unwritten = choices.filter((c) => !c.toSlug).length
  if (unwritten > 0) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `${unwritten} option(s) lead nowhere yet — they import as bricked archways, which is your to-write list.`,
    })
  }

  // ---- the entrance: the room nothing leads into.
  const hasInbound = new Set(choices.map((c) => c.toSlug).filter(Boolean) as string[])
  const roots = nodes.filter((n) => !hasInbound.has(n.slug))
  const rootSlug = roots[0]?.slug ?? nodes[0]?.slug ?? null

  if (roots.length > 1) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `${roots.length} rooms have nothing leading into them. ${rootSlug} was taken as the entrance; the rest import as sealed rooms you can reach from the ledger.`,
    })
  }
  if (roots.length === 0 && nodes.length > 0) {
    issues.push({
      severity: 'warning',
      row: null,
      message: `Every room has something leading into it, so there is no obvious entrance. ${rootSlug} was used — set the right one afterwards.`,
    })
  }
  if (nodes.length === 0) {
    issues.push({ severity: 'error', row: null, message: 'This file has no nodes in it.' })
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
