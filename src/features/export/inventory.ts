import type { StateVar, StoryGraph } from '@/types/domain'
import { INV_VAR } from './liquid'

/**
 * "What am I carrying?", answered on the phone.
 *
 * One reserved key, pressed in any room, plays back the satchel and drops the
 * caller back where they were standing. The shape is forced by two things:
 *
 *   Studio has no subroutine and no return. So the readback is emitted ONCE and
 *   shared, the room records where it came from in a variable on the way in,
 *   and a split at the far end sends the caller back. A per-room copy would
 *   have cost thirteen widgets times every room in the story.
 *
 *   Nothing is spoken by Twilio (§0). So an item is read back only if somebody
 *   recorded its name, and one that nobody has recorded is silence — reported,
 *   never synthesised.
 *
 * The return goes to the room's REPLAY, never its entry: coming back must not
 * re-run arrival effects, or checking your pockets would grant you the room's
 * item a second time.
 */

/** Where the caller was standing when they pressed the key. */
export const RET_VAR = 'ret'

export const INV_START = 'inv_start'
export const INV_NONE = 'inv_none'
export const INV_INTRO = 'inv_intro'
export const INV_RETURN = 'inv_return'

export const invRetName = (slug: string) => `inv_ret_${slug}`
export const invItemCheck = (slug: string) => `inv_${slug}_check`
export const invItemPlay = (slug: string) => `inv_${slug}_play`

export interface InventoryPlan {
  key: string
  /** Items with a take, in the order they will be read back. */
  spoken: StateVar[]
  /** Items a caller can hold that nobody has recorded — silence on the phone. */
  silent: StateVar[]
  introRecorded: boolean
  emptyRecorded: boolean
}

/**
 * What the readback will say, or null when the story hasn't asked for one.
 *
 * Only `item` vars: a flag like TALKED_TO_MIKE is state, not something in your
 * hands, and counters live in their own variables rather than in `inv`.
 */
export function planInventory(graph: StoryGraph): InventoryPlan | null {
  const key = graph.story.inventory_key
  if (!key) return null

  const items = [...graph.stateVars.values()]
    .filter((v) => v.kind === 'item')
    .sort((a, b) => a.slug.localeCompare(b.slug))

  return {
    key,
    spoken: items.filter((v) => v.audio_path),
    silent: items.filter((v) => !v.audio_path),
    introRecorded: Boolean(graph.story.inventory_intro_audio_path),
    emptyRecorded: Boolean(graph.story.inventory_empty_audio_path),
  }
}

/** The Liquid that is true when the caller is holding nothing at all. */
export function emptyHandedCondition(): string {
  // `inv` starts life unset and becomes "|" once anything has touched it, so
  // both have to count as empty.
  return `{{ flow.variables.${INV_VAR} | default: "|" }}`
}

/** Whether a story's reserved key collides with a door somewhere. */
export function keyCollisions(graph: StoryGraph): string[] {
  const key = graph.story.inventory_key
  if (!key) return []
  const out: string[] = []
  for (const choice of graph.choices.values()) {
    if (choice.digit !== key) continue
    const room = graph.nodes.get(choice.from_node_id)
    if (room) out.push(room.slug)
  }
  return [...new Set(out)].sort()
}
