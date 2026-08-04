import type { EffectOperation, StateVar, StoryGraph } from '@/types/domain'
import type { PlaybackPart } from '@/features/cast/dialogue'

/**
 * What is heard when an item changes hands.
 *
 * A story notices the moment, not the inventory: picking the rope up is a
 * beat, and until now the only things that could mark it were the room it
 * happened in and the door it happened at. Both are the wrong place when the
 * same item is picked up from three of them — you end up writing the sentence
 * three times, and re-recording it three times.
 *
 * So it lives on the ITEM, and it is heard wherever that item is granted or
 * spent. A door's REACTION is still the right place for what is true of that
 * particular threshold ("Mike hands over the helmet"); this is for what is
 * true of the thing itself.
 *
 * Pure, because three places have to agree about it: the exporter emits the
 * Play widgets, the playtest reads them out, and the audio targets list has to
 * name the file the same way both of them do.
 */

/** Which way an item moved. `spend` covers both a gate using it up and an
 *  effect taking it away — from the caller's side those are one event. */
export type ItemMove = 'gain' | 'spend'

/** The clip an item carries for one direction, or null when it has none. */
export function clipFor(item: StateVar, move: ItemMove): PlaybackPart | null {
  const say = (move === 'gain' ? item.gain_narration : item.spend_narration)?.trim() ?? ''
  const audioPath = move === 'gain' ? item.gain_audio_path : item.spend_audio_path
  if (!say && !audioPath) return null
  return { id: `${item.id}:${move}`, audioPath, say, speaker: null }
}

/**
 * An effect, as either of the two shapes the app carries it in.
 *
 * The exporter has the row and knows the item by id; the playtest has already
 * mapped it down to the slug the evaluator uses. Rather than two nearly-equal
 * functions, one that accepts whichever identifier it was handed — the answer
 * has to be the same either way, and that is exactly the property that keeps
 * the phone and the rehearsal in step.
 */
export interface MovedItem {
  operation: EffectOperation
  state_var_id?: string
  varSlug?: string
}

/**
 * Which items an effect list moves, and which way.
 *
 * `add` on a counter counts as a gain and `set` does not: going from two to
 * three of something is picking one up, but being told you now have three is
 * bookkeeping, and a story that said "you found a rope" when a counter was
 * reset would be lying. Deduplicated, in the order the effects are written —
 * two effects granting one item is one moment, not two.
 */
export function movesOf(graph: StoryGraph, effects: MovedItem[]): Array<[StateVar, ItemMove]> {
  const out: Array<[StateVar, ItemMove]> = []
  const seen = new Set<string>()
  for (const effect of effects) {
    const item = effect.state_var_id
      ? graph.stateVars.get(effect.state_var_id)
      : [...graph.stateVars.values()].find((v) => v.slug === effect.varSlug)
    if (!item) continue
    const move: ItemMove | null =
      effect.operation === 'grant' || effect.operation === 'add'
        ? 'gain'
        : effect.operation === 'revoke'
          ? 'spend'
          : null
    if (!move) continue
    const key = `${item.id}:${move}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push([item, move])
  }
  return out
}

/** The clips an effect list is heard to produce, in order. */
export function clipsFor(graph: StoryGraph, effects: MovedItem[]): PlaybackPart[] {
  return movesOf(graph, effects)
    .map(([item, move]) => clipFor(item, move))
    .filter((p): p is PlaybackPart => p !== null)
}

/** The clips for items a gate spent to open a door. */
export function spendClips(graph: StoryGraph, slugs: string[]): PlaybackPart[] {
  return slugs
    .map((slug) => [...graph.stateVars.values()].find((v) => v.slug === slug))
    .map((item) => (item ? clipFor(item, 'spend') : null))
    .filter((p): p is PlaybackPart => p !== null)
}
