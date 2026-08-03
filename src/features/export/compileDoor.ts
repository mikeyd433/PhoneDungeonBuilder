import type { Choice, Effect, NodeVariant, StoryGraph, StoryNode } from '@/types/domain'
import { reactionPlaybackFor } from '@/features/cast/dialogue'
import { consumePlan } from '@/features/state/consume'
import { hidesDoor } from '@/features/room/variants'
import {
  consumeAllLiquid,
  consumeLiquid,
  gateVarName,
  INV_VAR,
  readingVarName,
} from './liquid'
import { PATIENCE_VALVE_AT, type Widget } from './compile'

/**
 * One door, as widgets — everything between the keypress and the next room.
 *
 * Built back to front, because each widget has to know where the next one is
 * before it can be pushed. Reading the chain outward from the destination:
 *
 *   [ shown? ] -> [ gate ] -> [ reaction ] -> [ spend ] -> [ effects ] -> room
 *
 * with two deliberate exceptions:
 *
 *   * a DIVERT gate is a fork, not a refusal, so the reaction wraps the whole
 *     split — both routes hear it;
 *   * a door sharing its key with another is selected by the digit's own split
 *     back in the compiler, so it emits no `_shown` of its own.
 *
 * Lifted out of `compileStory` because this is the part that changes with
 * nearly every round of work, and it was 244 lines in the middle of a
 * 1,249-line function. Everything it needs is passed in, so what it depends on
 * is a list you can read rather than a scope you have to hold in your head.
 */
export interface DoorEmitContext {
  graph: StoryGraph
  node: StoryNode
  slug: string
  choice: Choice
  /** `2`, then `2b`, `2c` — so two doors on one key never collide by name. */
  dkey: string
  /** True when another door is on this key; its `_shown` split is the digit's. */
  sharesKey: boolean
  /** This room's alternate readings, in the order the export numbers them. */
  variants: NodeVariant[]
  audioBaseUrl: string
  widgets: Widget[]
  warnings: string[]
  gateByChoice: Map<string, import('@/types/domain').Gate>
  /** The widget that computed every gate boolean on this room, for the note. */
  gateWidget: string | null
  effectsFor: (predicate: (e: { node_id: string | null; choice_id: string | null }) => boolean) => Effect[]
  variablesFor: (effects: Effect[]) => Array<{ key: string; value: string }>
  entryName: (n: StoryNode) => string | null
  wname: (slug: string, suffix: string) => string
}

/** Where this door's chain begins — what the digit's transition points at. */
export function emitDoor(ctx: DoorEmitContext): string | null {
  const {
    graph,
    node,
    slug,
    choice,
    dkey,
    sharesKey,
    variants,
    audioBaseUrl,
    widgets,
    warnings,
    gateByChoice,
    gateWidget,
    effectsFor,
    variablesFor,
    entryName,
    wname,
  } = ctx

  const gate = gateByChoice.get(choice.id)
  const fx = effectsFor((e) => e.choice_id === choice.id)
  const target = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null

  // Where this digit ultimately lands, before any gate split.
  let dest: string | null = target ? entryName(target) : null
  if (!target) {
    warnings.push(
      `${slug} digit ${choice.digit} ("${choice.label}") is an unwritten branch — it has nowhere to go and is exported as a repeat.`,
    )
    dest = wname(slug, 'gather')
  }

  /**
   * The reaction to having pressed this digit — what is said between the
   * keypress and the next room.
   *
   * WHERE it wraps depends on what the gate is for:
   *
   *   refuse / hide — inside the gate, closest to the destination. Hearing
   *     the reaction to a thing you were not allowed to do would be worse
   *     than hearing nothing, and a refused door has its own take already.
   *
   *   divert — OUTSIDE the whole split, so both routes hear it. A divert is
   *     a fork, not a refusal: the caller pressed the key and went
   *     somewhere, and "Mike hands over the helmet" is the reaction to
   *     pressing it, not to passing a test.
   */
  const reactParts = reactionPlaybackFor(graph, choice.id)
  const reactRecorded = reactParts.filter((p) => p.audioPath)
  const reactName = (i: number) =>
    `${slug}_d${dkey}_react${i === 0 ? '' : `_line${i + 1}`}`
  const forks = gate?.fail_behavior === 'divert'

  /** Chain the reaction's widgets in front of `next`, back to front, so
   *  each already knows where the one after it is. */
  const wrapReaction = (next: string | null): string | null => {
    let at = next
    for (let i = reactRecorded.length - 1; i >= 0; i--) {
      const part = reactRecorded[i]
      widgets.push({
        name: reactName(i),
        type: 'say-play',
        nodeId: node.id,
        note: `Reaction to pressing ${choice.digit}.${part.speaker ? ` — ${part.speaker}` : ''}`,
        playUrl: `${audioBaseUrl}${part.audioPath}`,
        transitions: [{ event: 'audioComplete', next: at }],
      })
      at = reactName(i)
    }
    return at
  }

  if (!forks) dest = wrapReaction(dest)

  const reactMissing = reactParts.length - reactRecorded.length
  if (reactMissing > 0) {
    warnings.push(
      reactParts.length === 1
        ? `${slug} digit ${choice.digit} has a reaction written ("${reactParts[0].say.trim().slice(0, 40)}…") with no recording, so the caller hears nothing between pressing and arriving.`
        : `${slug} digit ${choice.digit}'s reaction plays line by line and ${reactMissing} of its ${reactParts.length} lines have no take — those lines are silent.`,
    )
  }

  // Spending what opened the door.
  //
  // This was honoured by the playtest and by the solver and emitted by
  // NEITHER — so a consumable was used up in rehearsal and kept forever on
  // the phone, which is the worst way round for a bug to sit: every test
  // said the story worked.
  //
  // Inside the gate and before the choice's own effects, because a caller
  // who was refused spends nothing, and an effect that grants something in
  // exchange should see the payment already made.
  if (gate?.consume_on_pass) {
    const plan = consumePlan(gate.expression, (s) =>
      Boolean([...graph.stateVars.values()].find((v) => v.slug === s)?.is_consumable),
    )
    if (plan.slugs.length > 0) {
      const spendName = `${slug}_d${dkey}_spend`
      widgets.push({
        name: spendName,
        type: 'set-variables',
        nodeId: node.id,
        note:
          plan.mode === 'first'
            ? `Spend whichever of ${plan.slugs.join(' / ')} opened this — only the one.`
            : `Spend ${plan.slugs.join(', ')}, which this door required.`,
        variables: [
          {
            key: INV_VAR,
            value:
              plan.mode === 'first' ? consumeLiquid(plan.slugs) : consumeAllLiquid(plan.slugs),
          },
        ],
        transitions: [{ event: 'next', next: dest }],
      })
      dest = spendName
    } else {
      // The checkbox is ticked and nothing it names is marked consumable, so
      // nothing is spent. Said out loud, because from the editor it looks
      // like it works.
      warnings.push(
        `${slug} digit ${choice.digit} is set to use up what opened it, but none of the items it requires are marked as used up — so nothing is spent.`,
      )
    }
  }

  // Choice effects: one widget, only if there is something to do (§6.2 —
  // "Don't pay widgets for nothing").
  if (fx.length > 0) {
    const fxName = `${slug}_d${dkey}_fx`
    widgets.push({
      name: fxName,
      type: 'set-variables',
      nodeId: node.id,
      note: `Effects for pressing ${choice.digit}.`,
      variables: variablesFor(fx),
      transitions: [{ event: 'next', next: dest }],
    })
    dest = fxName
  }

  if (gate && gate.fail_behavior !== 'hide') {
    const splitName = `${slug}_d${dkey}_gate`
    // Named separately from `failNext`, which may be null when a divert
    // lands on an unrecorded ending — a widget's own name never can be.
    const refuseName = `${slug}_d${dkey}_refuse`
    const failNext: string | null =
      gate.fail_behavior === 'divert'
        ? gate.fail_node_id
          ? entryName(graph.nodes.get(gate.fail_node_id) ?? node)
          : wname(slug, 'gather')
        : gate.fail_audio_path
          ? refuseName
          : wname(slug, 'gather')

    widgets.push({
      name: splitName,
      type: 'split-based-on',
      nodeId: node.id,
      note: `Gate on digit ${choice.digit}; the boolean was computed in ${gateWidget}.`,
      splitOn: `{{flow.variables.${gateVarName(slug, choice.digit)}}}`,
      transitions: [
        {
          event: 'match',
          condition: 'Equal To pass',
          match: { type: 'equal_to', value: 'pass' },
          next: dest,
        },
        { event: 'noMatch', next: failNext },
      ],
    })

    if (gate.fail_behavior === 'refuse') {
      // A refusal is a line like any other. Unrecorded, it isn't spoken —
      // the caller is simply bounced back to the choices, which is a poor
      // experience but not a robot voice mid-scene.
      if (gate.fail_audio_path) {
        widgets.push({
          name: refuseName,
          type: 'say-play',
          nodeId: node.id,
          note:
            'Refusal. Returns to the GATHER, not the play widget, so the caller ' +
            `doesn't re-hear the whole scene. Route the ${PATIENCE_VALVE_AT}th attempt to an escape.`,
          playUrl: `${audioBaseUrl}${gate.fail_audio_path}`,
          transitions: [{ event: 'audioComplete', next: wname(slug, 'gather') }],
        })
      } else {
        warnings.push(
          `${slug} digit ${choice.digit} refuses the caller with no recording, so they are sent back to the choices without being told why.`,
        )
      }
    }
    dest = splitName
    // A fork: both routes are somewhere the caller chose to go, so the
    // reaction to choosing wraps the split rather than one branch of it.
    if (forks) dest = wrapReaction(dest)
  }

  /**
   * A door only some readings offer.
   *
   * The reading number is already sitting in a flow variable, computed
   * before the room played, so "is this door here" costs one split on a
   * value that exists rather than a second evaluation of anything.
   *
   * The digit is still ACCEPTED — a gather takes what it takes — but it
   * goes back to the choices instead of through, which is the same shape a
   * `hide` gate has. What is different is that the reading which offers the
   * door is also the one that announces it, so the caller is never left
   * guessing at a key that works but was never mentioned.
   */
  // A door sharing its key is selected by the digit's own split below,
  // which already knows which state gets which door — a second split per
  // door would ask the same question twice and answer it identically.
  const hiddenIn = sharesKey ? [] : hidesDoor(graph, choice.id)
  if (hiddenIn.length > 0 && variants.length > 0) {
    const shownIn = [null, ...variants.map((v) => v.id)]
      .map((id, i) => ({ id, number: i }))
      .filter((slot) => !hiddenIn.includes(slot.id))

    if (shownIn.length === 0) {
      // Hidden everywhere: no state a caller can be in reaches it. From the
      // editor this looks like an ordinary door.
      warnings.push(
        `${slug} digit ${choice.digit} ("${choice.label}") is hidden under every reading, so no caller is ever offered it.`,
      )
    }

    const showName = `${slug}_d${dkey}_shown`
    widgets.push({
      name: showName,
      type: 'split-based-on',
      nodeId: node.id,
      note:
        shownIn.length === 0
          ? 'This door is hidden under every reading — the digit does nothing.'
          : `Digit ${choice.digit} is only offered under reading(s) ${shownIn
              .map((s) => s.number)
              .join(', ')} (0 = the room as written).`,
      splitOn: `{{flow.variables.${readingVarName(slug)}}}`,
      transitions: [
        ...shownIn.map((slot) => ({
          event: 'match',
          condition: `Equal To ${slot.number}`,
          match: { type: 'equal_to' as const, value: String(slot.number) },
          next: dest,
        })),
        { event: 'noMatch', next: wname(slug, 'gather') },
      ],
    })
    dest = showName
  } else if (hiddenIn.length > 0) {
    // Visibility rules with nothing to vary on. Not silently ignored: the
    // author wrote a rule and it has no effect.
    warnings.push(
      `${slug} digit ${choice.digit} is hidden under a reading, but this room has no readings — so the door is always offered.`,
    )
  }

  return dest
}
