import { slugify, uniqueSlug } from '@/lib/slug'
import type { StoryGraph, StoryNode } from '@/types/domain'

/**
 * When naming a room should move its slug too.
 *
 * A room chiselled through a door takes its slug from that door's label,
 * because a slug is an identifier and ENTER_THE_DOOR is far easier to find in
 * the bucket or the exported flow than ROOM_87. But that left the door's words
 * stuck to the room permanently: relabel the door and the room still answered
 * to the old wording, in the widget names, in the audio manifest, and — while
 * the room had no title of its own — on every plate that showed it.
 *
 * So the slug follows the title, ONCE: on the step from unnamed to named. That
 * is the moment the author says what the place actually is, and it is the only
 * moment where moving the identifier is free.
 *
 * It deliberately does NOT follow later renames. By then the slug is out in the
 * world — an actor has a manifest asking for `SLUG__line1`, and a flow has been
 * imported into Studio with those widget names — and churning it on every
 * wording tweak would break more than it tidied. The editor's slug field is
 * there for the deliberate case.
 */
export function slugFollowingTitle(
  graph: StoryGraph,
  before: StoryNode,
  patch: Partial<StoryNode>,
): string | null {
  // An explicit slug in the same write wins: the author said it outright.
  if (patch.slug !== undefined) return null
  if (patch.title === undefined) return null

  const named = String(patch.title).trim()
  if (!named) return null
  // Only the unnamed -> named step.
  if ((before.title ?? '').trim()) return null

  // A title with no letters in it — "!!!" — slugifies to the generic ROOM.
  // That is a worse identifier than the door's words, so leave it be.
  const base = slugify(named)
  if (base === 'ROOM') return null

  const taken = [...graph.nodes.values()].filter((n) => n.id !== before.id).map((n) => n.slug)
  const next = uniqueSlug(base, taken)
  return next === before.slug ? null : next
}
