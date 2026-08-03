import type { DerivedGraph, StoryGraph, StoryNode } from '@/types/domain'
import { planCollapse, type CollapsePlan } from './collapse'
import { isPromptLine } from './prompts'

/**
 * Cleaning up after the import.
 *
 * A Brainstorm export has no concept of a room. Every node became one, and its
 * text became that room's *title* — so half the story is named with a whole
 * sentence, and some of those sentences are the door prompts themselves. Those
 * names are now the biggest thing on the map and on every door plate.
 *
 * Two passes, both suggestions and neither automatic: a wrong guess applied to
 * 77 rooms at once is far harder to undo than to avoid. Everything here is
 * pure, so what WOULD happen can be shown before anything is written.
 */

/** Longer than this and a title has stopped being a name. */
export const LONG_TITLE = 34

export interface TitleFix {
  nodeId: string
  slug: string
  was: string
  /** The short name being offered. Never applied without being accepted. */
  suggestion: string
  /** True when the old title is script — it should go into the narration
   *  rather than being thrown away. */
  isScript: boolean
  /** The narration this room would end up with, if the title is script and the
   *  narration does not already contain it. Null means leave the text alone. */
  narration: string | null
}

/**
 * A short name for a room currently titled with a sentence.
 *
 * Deliberately dumb: the first clause, capped at a few words. A cleverer guess
 * is a guess that is wrong in a way nobody notices, and every one of these is
 * shown before it is applied.
 */
export function suggestShortTitle(title: string): string {
  let text = title.trim()
  // Leading stage directions and conditions: "(If you have helmet) Press 1…"
  text = text.replace(/^\([^)]*\)\s*/, '')
  // A speaker prefix is not the room's name — "CARTER: the door is stuck",
  // "both: we are lost". Lowercase counts: the import is full of "both:".
  text = text.replace(/^[A-Za-z][A-Za-z' ]{0,20}:\s*/, '')
  // A parenthetical aside mid-sentence, which otherwise leaves a dangling "(".
  text = text.replace(/\s*\([^)]*\)\s*/g, ' ')

  // Stop at the first clause break. A full stop only counts when it is not an
  // abbreviation — splitting "Hey Mr. Hawk" gave "Hey Mr", which is worse than
  // offering nothing.
  const parts = text.split(/(?<=[.!?…])\s+|\s+[-–—]\s+|,\s+/)
  let clause = parts[0] ?? text
  let i = 1
  while (i < parts.length && ABBREVIATION.test(clause)) clause = `${clause} ${parts[i++]}`

  const words = clause.trim().split(/\s+/).filter(Boolean)
  const short = words
    .slice(0, 5)
    .join(' ')
    // Dangling punctuation from the cut, and a trailing ellipsis that only ever
    // meant "there is more" — which a name does not need to say.
    .replace(/[\s.,;:!?…"“”'’(-]+$/, '')
    .replace(/^[\s"“”'’(-]+/, '')
  if (!short) return ''
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/** Full stops that end a word rather than a sentence. */
const ABBREVIATION = /(?:^|\s)(?:[A-Za-z]|mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|e\.g|i\.e)\.$/i

/** Does this title read as something said out loud rather than a name? */
export function looksLikeScript(title: string): boolean {
  const t = title.trim()
  return (
    t.length > LONG_TITLE ||
    isPromptLine(t) ||
    /[.!?…]\s|["“”]/.test(t) ||
    /^\(/.test(t) ||
    /^[A-Z][A-Za-z' ]{0,20}:\s/.test(t)
  )
}

/** Every room whose title has stopped being a name, with what to do about it. */
export function titlesToTidy(graph: StoryGraph): TitleFix[] {
  const out: TitleFix[] = []
  for (const node of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const was = (node.title ?? '').trim()
    if (!was || !looksLikeScript(was)) continue
    const suggestion = suggestShortTitle(was)
    // No shorter form worth offering — leave it be rather than propose the
    // same string back.
    if (!suggestion || suggestion === was) continue

    out.push({
      nodeId: node.id,
      slug: node.slug,
      was,
      suggestion,
      isScript: true,
      narration: rescuedNarration(node, was),
    })
  }
  return out
}

/**
 * Where the old title goes.
 *
 * Those sentences are not junk — they are what the caller hears, sitting in the
 * wrong column. But only when the narration does not already say it: the
 * importer put the same text in both places often enough that appending
 * blindly would give half the story a stutter.
 */
function rescuedNarration(node: StoryNode, title: string): string | null {
  const narration = (node.narration ?? '').trim()
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ')
  if (narration && normalise(narration).includes(normalise(title))) return null
  return narration ? `${title}\n\n${narration}` : title
}

// ------------------------------------------------------------ rooms

export interface CollapseCandidate {
  nodeId: string
  slug: string
  title: string
  plan: CollapsePlan
  /** Why it looks like an action rather than a place. Shown, so the judgement
   *  is the author's and not this function's. */
  because: string
}

/** Titles that name a thing you DO. The import is full of them. */
const ACTION = /^(enter|open|close|go|walk|climb|take|pick|grab|use|push|pull|turn|press|look|check|wait|leave|drop|give|put|read|listen|touch|move|jump|run|follow|continue|proceed|head|step|try|search|examine)\b/i

/**
 * Rooms that were probably actions on the way through, not places to stand.
 *
 * The shape is the giveaway: one way in, one way out, nothing written of any
 * length, and a title that starts with a verb. `planCollapse` still has the
 * final say — it refuses the entrance, endings, fights, forks and anything
 * carrying dialogue, effects or gates — so nothing here can propose a collapse
 * that would lose work.
 */
export function collapseCandidates(graph: StoryGraph, derived: DerivedGraph): CollapseCandidate[] {
  const out: CollapseCandidate[] = []
  for (const node of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const check = planCollapse(graph, derived, node.id)
    if (!check.ok) continue

    const title = (node.title ?? '').trim()
    const inbound = derived.edgesTo.get(node.id)?.length ?? 0
    // The title wins when there is one. A room chiselled through "enter door"
    // keeps that slug forever, so reading the slug over a deliberate rename
    // would keep offering to delete a room the author has just named a place.
    const verb = title ? ACTION.test(title) : ACTION.test(node.slug.replace(/_/g, ' '))
    const brief = (node.narration ?? '').trim().length <= 60

    // Only offer the ones that look like actions. A room that merely CAN be
    // collapsed is not a room that should be, and a list of 120 of them would
    // be a list nobody reads.
    if (!verb || !brief || inbound === 0) continue

    out.push({
      nodeId: node.id,
      slug: node.slug,
      title: title || node.slug,
      plan: check.plan,
      because: [
        verb ? 'named for something you do' : null,
        brief ? 'almost nothing written here' : null,
        `one way in, one way out to ${check.plan.toTitle}`,
      ]
        .filter(Boolean)
        .join(' · '),
    })
  }
  return out
}
