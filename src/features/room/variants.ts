import type { NodeVariant, StoryGraph } from '@/types/domain'
import type { PlaybackPart } from '@/features/cast/dialogue'
import { playbackFor } from '@/features/cast/dialogue'
import { evaluate, type CallerState, type VarIndex } from '@/features/state/expression'

/**
 * A room that reads differently depending on what the caller is carrying.
 *
 * Until now, state could change which DOORS a room offers — a gate set to
 * `hide` removes one — but never what the room SAYS. The workaround was two
 * rooms and a divert between them, which duplicates the doors, the effects and
 * the recording, and drifts the moment either copy is edited.
 *
 * The rule is an if/elsif chain, in the author's order: the FIRST variant whose
 * expression passes is what plays, and if none do the room's own narration
 * plays. The room itself is the "otherwise" rather than a fourth variant, which
 * is what makes adding this to a story change nothing about a room without one.
 *
 * Everything here is pure. The playtest asks it with the caller's real state;
 * the exporter never asks it at all — it emits the whole chain as Liquid and
 * lets Studio decide on the call.
 */

/** A room's alternate readings, in the order they are tried. */
export function variantsOf(graph: StoryGraph, nodeId: string): NodeVariant[] {
  return [...graph.variants.values()]
    .filter((v) => v.node_id === nodeId)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

/**
 * Which reading applies to a caller in this state, or null for the room's own.
 *
 * First match wins. An empty `and` — a variant whose condition nobody has filled
 * in — evaluates true, so it would swallow everything below it; that is exactly
 * what `variantProblems` reports rather than something to special-case here,
 * because silently skipping an unconditional variant would make it impossible to
 * write a deliberate catch-all.
 */
export function readingFor(
  graph: StoryGraph,
  nodeId: string,
  caller: CallerState,
  index: VarIndex,
): NodeVariant | null {
  for (const variant of variantsOf(graph, nodeId)) {
    if (evaluate(variant.expression, caller, index)) return variant
  }
  return null
}

/**
 * What a variant plays, in the shape everything else already consumes.
 *
 * One part, always. A room's base narration can split into attributed lines for
 * two separately-booked actors; a variant cannot — it is an alternate reading,
 * recorded the way an alternate reading is.
 */
export function variantPlayback(variant: NodeVariant): PlaybackPart[] {
  return [{ id: variant.id, audioPath: variant.audio_path, say: variant.narration, speaker: null }]
}

/**
 * A check chain that sends the caller somewhere can send them somewhere that
 * checks again. Ten hops is far past anything deliberate and short of a hang.
 */
export const MAX_ARRIVAL_HOPS = 10

/** One stop on the way in: what is heard here, and whether it goes on. */
export interface ArrivalStep {
  nodeId: string
  /** The reading that applied, or null for the room's own words. */
  variant: NodeVariant | null
}

/**
 * Walking into a room, following every check that says "not here, there".
 *
 * The caller does not choose this and cannot refuse it, so it is resolved in
 * one go: the returned list is every room passed through, in order, and the
 * last one is where they end up standing. Anything with words is heard on the
 * way — a check with a reading and a destination is "hear this, then go".
 *
 * `effectsAt` is passed in rather than imported because the caller's state has
 * to be advanced by each room's arrival effects as it goes, and this module has
 * no business knowing how effects are applied. The playtest and the solver both
 * hand it their own.
 *
 * A cycle is a story bug — two rooms each checking the same item and pointing at
 * each other — and it stops at `MAX_ARRIVAL_HOPS` with the chain so far, so the
 * ledger can say where rather than the phone hanging up.
 */
export function walkArrival(
  graph: StoryGraph,
  nodeId: string,
  caller: CallerState,
  index: VarIndex,
  effectsAt: (nodeId: string, state: CallerState) => CallerState,
): { steps: ArrivalStep[]; caller: CallerState; looped: boolean } {
  const steps: ArrivalStep[] = []
  const seen = new Set<string>()
  let at = nodeId
  let state = effectsAt(nodeId, caller)

  for (let hop = 0; hop < MAX_ARRIVAL_HOPS; hop++) {
    const variant = readingFor(graph, at, state, index)
    steps.push({ nodeId: at, variant })
    seen.add(at)

    const next = variant?.goto_node_id
    if (!next || !graph.nodes.has(next)) return { steps, caller: state, looped: false }
    // A room reached twice on one arrival is a loop the caller cannot break.
    if (seen.has(next)) return { steps, caller: state, looped: true }

    at = next
    state = effectsAt(next, state)
  }
  return { steps, caller: state, looped: true }
}

/** What this room plays for a caller in this state: a variant, or the room. */
export function playbackWithState(
  graph: StoryGraph,
  nodeId: string,
  caller: CallerState,
  index: VarIndex,
): PlaybackPart[] {
  const variant = readingFor(graph, nodeId, caller, index)
  return variant ? variantPlayback(variant) : playbackFor(graph, nodeId)
}

/**
 * Every part of this room somebody could record — the base and every variant.
 *
 * The torch, the manifest and the export warnings all want this: a room with a
 * finished base reading and an unrecorded variant is a room that plays silence
 * to anyone carrying the thing, and lighting it would be the atmosphere-over-
 * data §0 forbids.
 */
export function allReadings(graph: StoryGraph, nodeId: string): PlaybackPart[] {
  return [...playbackFor(graph, nodeId), ...variantsOf(graph, nodeId).flatMap(variantPlayback)]
}

/**
 * What is wrong with a room's variant chain, in the author's words.
 *
 * Both of these are unreachable-code warnings and neither is a database
 * constraint, because both are legitimate half-finished states — you write the
 * condition after the words as often as before.
 */
export function variantProblems(graph: StoryGraph, nodeId: string): string[] {
  const variants = variantsOf(graph, nodeId)
  const out: string[] = []

  variants.forEach((variant, i) => {
    // A check that sends the caller back where they came from is a loop with
    // no keypress in it: they arrive, they are sent here, they arrive.
    if (variant.goto_node_id === nodeId) {
      out.push(`Reading ${i + 1} sends the caller into the room they are already in.`)
    }
    const empty =
      (variant.expression.op === 'and' || variant.expression.op === 'or') &&
      variant.expression.args.length === 0
    if (empty && variant.expression.op === 'and' && i < variants.length - 1) {
      out.push(
        `Reading ${i + 1} has no condition, so it always plays and nothing below it ever will.`,
      )
    }
    if (empty && variant.expression.op === 'or') {
      out.push(`Reading ${i + 1} has no condition on an "any", so it can never play.`)
    }
    // Words are only missing if there is nothing else for it to do. A check
    // that walks the caller straight on is a complete, deliberate thing.
    if (!variant.narration.trim() && !variant.goto_node_id) {
      out.push(`Reading ${i + 1} has no words yet.`)
    }
  })

  return out
}
