import type { StoryGraph, StoryNode } from '@/types/domain'
import { graphEdges } from '@/features/graph/edges'
import { playbackFor } from '@/features/cast/dialogue'
import { fightsByNode, movesOf, outcomesOf, roundsOf } from '@/features/fight/model'
import {
  counterAddLiquid,
  counterSetLiquid,
  counterVar,
  gateAssignmentLiquid,
  gateVarName,
  grantLiquid,
  INV_VAR,
  revokeLiquid,
} from './liquid'
import { doorsByDigit, keyConflicts } from '@/features/room/keys'
import { emitFight } from './compileFight'
import { emitDoor } from './compileDoor'

/**
 * Compile a story into a Twilio Studio widget graph (§6.2, §6.5, §6.7).
 *
 * ORDERING (§6.2): a choice's effects must fire after the gather resolves that
 * digit and before the destination plays. Node effects fire before that node's
 * play widget, so narration can reference what the caller just gained.
 *
 * ONE DELIBERATE DEPARTURE from §6.6's build-sheet example, which shows
 * play -> gates -> gather. That ordering cannot work for a `hide` gate: §6.3
 * says the narration itself is Liquid-conditional, so the gate result has to
 * exist *before* the play widget runs. Evaluating all gates before play
 * satisfies `hide`, `refuse` and `divert` alike and costs exactly the same one
 * batched widget, so that is what this emits.
 */

export type WidgetType =
  | 'say-play'
  | 'gather-input-on-call'
  | 'set-variables'
  | 'split-based-on'

export interface Transition {
  event: string
  /** Human label, for the build sheet. */
  condition?: string
  /**
   * What Studio actually evaluates.
   *
   * `condition` alone is prose. A flow whose transitions carry only a
   * friendly_name imports without complaint and then never matches anything —
   * every call falls straight through to noMatch. The subject being compared
   * comes from the widget (a split's input, a gather's digits), so only the
   * test and the value live here.
   */
  match?: { type: 'equal_to' | 'contains' | 'less_than'; value: string }
  next: string | null
}

export interface Widget {
  name: string
  type: WidgetType
  /** Human explanation for the build sheet. */
  note?: string
  /** For say-play. */
  say?: string
  playUrl?: string
  /** For set-variables: key -> Liquid value. */
  variables?: Array<{ key: string; value: string }>
  /** For split-based-on. */
  splitOn?: string
  /** Widget-type settings Studio needs and cannot infer — a gather's digit
   *  count and timeout were described in the note and nowhere else. */
  properties?: Record<string, unknown>
  transitions: Transition[]
  /** Source node, for grouping and layout. */
  nodeId?: string
}

export interface CompileResult {
  widgets: Widget[]
  warnings: string[]
  budget: {
    total: number
    limit: number
    /** §6.5 warns at 80%. */
    warn: boolean
  }
  /** §6.5's separate step-depth check against the 1,000-step execution cap. */
  longestPathSteps: number
  stepCapRisk: boolean
  /** The widget an incoming call starts at. Not always `<root>_play`: an
   *  unrecorded entrance has no play widget, and one with arrival effects
   *  starts at those. */
  entryWidget: string | null
}

/** §6.0 — 2,000 widgets across the parent flow and all linked subflows. */
/**
 * Studio's own ceiling: the flow-definition schema caps `states` at 1000.
 * This said 2000, so the meter would have reported a comfortable margin on a
 * flow the API refuses outright.
 */
export const WIDGET_LIMIT = 1000
/** §6.0 — an execution ends after 1,000 steps. */
export const STEP_LIMIT = 1000
/**
 * §6.3 — Studio kills an execution if the same widget runs 10 times in a row,
 * so a caller mashing a locked door gets hung up on. Route the 8th failure to
 * an escape instead. The spec calls this a "patience valve".
 */
export const PATIENCE_VALVE_AT = 8

import {
  emptyHandedCondition,
  INV_NONE,
  INV_INTRO,
  INV_RETURN,
  INV_START,
  invItemCheck,
  invItemPlay,
  invRetName,
  keyCollisions,
  planInventory,
  RET_VAR,
} from './inventory'

/**
 * One digit, no speech, and the room's own patience.
 *
 * `say: ''` is not decoration and must not be removed. The gather widget's
 * schema requires ONE OF `say` or `play`:
 *
 *   "oneOf": [{ "required": ["say"] }, { "required": ["play"] }]
 *
 * — and every gather in this flow is silent, because the room said its piece in
 * the say-play widgets before it. Without either key the whole definition fails
 * validation and Studio reports nothing but "Something went wrong", which is
 * the same trap the per-digit conditions fell into.
 *
 * Empty rather than `play`: pointing the gather at the room's audio would play
 * it a second time, and there is no text to synthesise here, so the no-TTS rule
 * is untouched — an empty Say speaks nothing.
 */
export function gatherProperties(timeoutSeconds: number): Record<string, unknown> {
  return {
    say: '',
    loop: 1,
    number_of_digits: 1,
    stop_gather: true,
    timeout: timeoutSeconds,
    gather_language: 'en',
  }
}

const wname = (slug: string, suffix: string) => `${slug}_${suffix}`

function digitToken(digit: string): string {
  if (digit === '*') return 'star'
  if (digit === '#') return 'hash'
  return digit
}

export function compileStory(graph: StoryGraph, audioBaseUrl: string): CompileResult {
  const widgets: Widget[] = []
  const warnings: string[] = []

  const slugOf = (id: string) => graph.stateVars.get(id)?.slug ?? ''
  const nodes = [...graph.nodes.values()]
  const gateByChoice = new Map([...graph.gates.values()].map((g) => [g.choice_id, g]))
  const fights = fightsByNode(graph)

  const choicesFrom = (nodeId: string) =>
    [...graph.choices.values()]
      .filter((c) => c.from_node_id === nodeId)
      .sort((a, b) => a.sort_order - b.sort_order)

  const effectsFor = (predicate: (e: { node_id: string | null; choice_id: string | null }) => boolean) =>
    [...graph.effects.values()].filter(predicate).sort((a, b) => a.sort_order - b.sort_order)

  /** Every effect on one owner collapses into ONE set-variables widget (§6.1). */
  const variablesFor = (
    effects: ReturnType<typeof effectsFor>,
  ): Array<{ key: string; value: string }> => {
    const vars: Array<{ key: string; value: string }> = []
    // Inventory changes all write the same `inv` key, so they must be folded
    // into a single chained expression rather than emitted as separate keys —
    // two keys with the same name in one widget would silently drop one.
    const invEffects = effects.filter((e) => graph.stateVars.get(e.state_var_id)?.kind !== 'counter')
    if (invEffects.length === 1) {
      const slug = slugOf(invEffects[0].state_var_id)
      vars.push({
        key: INV_VAR,
        value: invEffects[0].operation === 'revoke' ? revokeLiquid(slug) : grantLiquid(slug),
      })
    } else if (invEffects.length > 1) {
      vars.push({ key: INV_VAR, value: chainedInventoryLiquid(invEffects.map((e) => ({
        slug: slugOf(e.state_var_id),
        revoke: e.operation === 'revoke',
      }))) })
    }

    for (const e of effects) {
      const v = graph.stateVars.get(e.state_var_id)
      if (v?.kind !== 'counter') continue
      const slug = v.slug
      vars.push({
        key: counterVar(slug),
        value:
          e.operation === 'set'
            ? counterSetLiquid(slug, e.amount ?? 0)
            : counterAddLiquid(slug, e.operation === 'revoke' ? -(e.amount ?? 1) : (e.amount ?? 1)),
      })
    }
    return vars
  }

  const inventory = planInventory(graph)
  const collidingRooms = new Set(keyCollisions(graph))
  /** Every room that can jump to the readback, and where it comes back to. */
  const returnsTo: Array<{ slug: string; next: string | null }> = []

  const playName = (slug: string) => wname(slug, 'play')

  /** A fight's round widgets: `SHARKS_r1_play` then `SHARKS_r1_gather`. */
  const roundName = (slug: string, index: number, part: 'play' | 'gather') =>
    `${slug}_r${index + 1}_${part}`

  /** Entering a round: its recording if it has one, otherwise the keypad. */
  const roundEntry = (slug: string, rounds: Array<{ audio_path: string | null }>, i: number) =>
    rounds[i]?.audio_path ? roundName(slug, i, 'play') : roundName(slug, i, 'gather')

  /**
   * What a room does once its audio has finished — or straight away, when it
   * has none.
   *
   * Only local names, so this can never recurse into another node.
   */
  const afterAudioName = (n: StoryNode): string | null => {
    // Studio has no hangup widget — it is not in the flow schema's list of
    // types at all, and emitting one made the whole import fail validation.
    // A call ends when execution reaches a transition with no target, so an
    // ending simply leads nowhere.
    if (n.node_type === 'ending') return null
    if (fights.has(n.id)) return `${n.slug}_reset`
    return wname(n.slug, 'gather')
  }

  /** The room read out. */
  const baseAudioName = (n: StoryNode): string | null =>
    playbackFor(graph, n.id).some((p) => p.audioPath) ? playName(n.slug) : afterAudioName(n)

  /**
   * Replaying a room: its audio again if it has any, else its choices. Used by
   * the timeout and wrong-keypress defaults, which must NOT re-run arrival
   * effects — granting the same item twice for hesitating would be a gift.
   */
  const replayName = (n: StoryNode): string | null => baseAudioName(n)

  /**
   * The first widget a caller ENTERING this room actually runs.
   *
   * Everything that points at a room points here. Targeting the play widget
   * directly — which is what this used to do — skipped the arrival effects and
   * the batched gate evaluation entirely, so an item granted on arrival was
   * never granted and a gate was tested against a variable nothing had set.
   * It also breaks outright now that an unrecorded room has no play widget.
   */
  const entryName = (n: StoryNode): string | null => {
    if (effectsFor((e) => e.node_id === n.id).length > 0) return wname(n.slug, 'fx')
    if (choicesFrom(n.id).some((c) => gateByChoice.has(c.id))) return wname(n.slug, 'gates')
    return replayName(n)
  }

  /**
   * Where a fight outcome leads. An outcome with nowhere set falls back to the
   * fight's own room, so the flow is still connected — the warning is what tells
   * the author it needs finishing, not a dangling transition Studio would refuse
   * to import.
   */
  const fightOutcome = (targetId: string | null, fallback: StoryNode) => {
    const target = targetId ? graph.nodes.get(targetId) : null
    return entryName(target ?? fallback)
  }

  for (const node of nodes) {
    const slug = node.slug
    const outgoing = choicesFrom(node.id)
    const gated = outgoing.filter((c) => gateByChoice.has(c.id))
    const fight = fights.get(node.id)
    const rounds = fight ? roundsOf(graph, fight.id) : []
    const moves = fight ? movesOf(graph, fight.id) : []
    const outcomes = fight ? outcomesOf(graph, fight.id) : new Map()

    // ---- arrival effects, before play so narration can reference them (§6.2)
    const arrival = effectsFor((e) => e.node_id === node.id)
    if (arrival.length > 0) {
      widgets.push({
        name: wname(slug, 'fx'),
        type: 'set-variables',
        nodeId: node.id,
        note: 'Arrival effects — fire before the room is described.',
        variables: variablesFor(arrival),
        transitions: [{ event: 'next', next: null }], // filled in below
      })
    }

    // ---- batched gate evaluation, before play (see the header note)
    let gateWidget: string | null = null
    if (gated.length > 0) {
      gateWidget = wname(slug, 'gates')
      widgets.push({
        name: gateWidget,
        type: 'set-variables',
        nodeId: node.id,
        note: `All ${gated.length} gate(s) on this room, batched into one widget (§6.3).`,
        variables: gated.map((c) => {
          const gate = gateByChoice.get(c.id)!
          return { key: gateVarName(slug, c.digit), value: gateAssignmentLiquid(gate.expression) }
        }),
        transitions: [{ event: 'next', next: replayName(node) }],
      })
      if (arrival.length > 0) {
        widgets.find((w) => w.name === wname(slug, 'fx'))!.transitions = [
          { event: 'next', next: gateWidget },
        ]
      }
    } else if (arrival.length > 0) {
      widgets.find((w) => w.name === wname(slug, 'fx'))!.transitions = [
        { event: 'next', next: replayName(node) },
      ]
    }

    // ---- the room itself
    const hideGated = outgoing.filter(
      (c) => gateByChoice.get(c.id)?.fail_behavior === 'hide',
    )
    // §6.3: a hidden choice simply isn't spoken. Wrapping each hidden line in
    // a Liquid conditional costs no extra widget.
    const hiddenLines = hideGated
      .map(
        (c) =>
          `{% if flow.variables.${gateVarName(slug, c.digit)} == "pass" %} Press ${c.digit} to ${c.label}.{% endif %}`,
      )
      .join('')

    // Where the room's narration hands off. A fight room's narration is the
    // lead-in, so it hands off to round one rather than to a gather.
    const roomExit = () => afterAudioName(node)

    // The room's audio. Usually one widget; a conversation assembled from
    // separately-booked actors is one widget per line, played back to back and
    // landing on the same exit — which is what makes "hold the conversation,
    // then offer the choice" a single room rather than a chain of them.
    //
    // ONLY RECORDED PARTS ARE EMITTED. There is no text-to-speech fallback
    // anywhere in this exporter: a robot voice sitting next to real
    // performances is worse than silence, because it ships and it hides which
    // rooms still need a session. An unrecorded part is skipped and reported.
    const parts = playbackFor(graph, node.id)
    const recorded = parts.filter((p) => p.audioPath)
    const partName = (i: number) => (i === 0 ? playName(slug) : `${slug}_line${i + 1}`)

    recorded.forEach((part, i) => {
      const last = i === recorded.length - 1
      widgets.push({
        name: partName(i),
        type: 'say-play',
        nodeId: node.id,
        note: `Play the recorded audio.${part.speaker ? ` — ${part.speaker}` : ''}`,
        playUrl: `${audioBaseUrl}${part.audioPath}`,
        transitions: [{ event: 'audioComplete', next: last ? roomExit() : partName(i + 1) }],
      })
    })

    const missingParts = parts.length - recorded.length
    if (missingParts > 0) {
      warnings.push(
        parts.length === 1
          ? `${slug} has no recording, so the caller hears nothing before the choices.`
          : `${slug} plays line by line and ${missingParts} of its ${parts.length} lines have no take — those lines are silent.`,
      )
    }

    // A hidden choice is spoken by a Liquid conditional, and a Liquid
    // conditional needs text for Studio to read. With recorded audio there is
    // nowhere to put it. The digit still WORKS — the gather accepts it and the
    // gate still routes — it simply is not announced, which for a `hide` gate
    // is arguably the point. Said out loud either way, because the alternative
    // is an author wondering why their line never plays.
    if (hiddenLines && recorded.length > 0) {
      warnings.push(
        `${slug} hides ${hideGated.length} choice(s) behind a gate, but the room is recorded audio — nothing announces them, so a caller has to already know the digit.`,
      )
    }

    // An ending needs no widget of its own: its recording (if any) was emitted
    // above and leads nowhere, which is how a Studio call hangs up.
    if (node.node_type === 'ending') continue

    // ---- a fight: two widgets per round, and no gather for the room itself
    if (fight) {
      emitFight({
        graph,
        node,
        slug,
        outgoing,
        fight,
        moves,
        rounds,
        outcomes,
        audioBaseUrl,
        widgets,
        warnings,
        entryName,
        fightOutcome,
        roundName,
        roundEntry,
      })
      continue
    }


    // ---- gather
    /** One per digit, for the split that follows the gather. */
    const keyTransitions: Transition[] = []

    /**
     * Doors grouped by the key that reaches them.
     *
     * Two doors on one digit is a story bug now that a room has one wall, but
     * the rows can exist, so their widgets still need names that do not collide
     * (error 81022's second cause) and the digit still needs ONE transition —
     * two `Digits equals 2` off one split and Studio silently takes the first.
     */
    const byDigit = doorsByDigit(graph, node.id)
    /** `2`, then `2b`, `2c` — so `CELL_d2_gate` keeps the name it always had. */
    const keyOf = (choice: (typeof outgoing)[number]) => {
      const group = byDigit.get(choice.digit) ?? []
      const i = group.findIndex((c) => c.id === choice.id)
      return i <= 0
        ? digitToken(choice.digit)
        : `${digitToken(choice.digit)}${String.fromCharCode(96 + i + 1)}`
    }
    /** Where each door's chain begins, once it is built. */
    const destOf = new Map<string, string | null>()

    for (const conflict of keyConflicts(graph, node.id)) {
      warnings.push(
        `${slug} has ${conflict.choiceIds.length} doors on digit ${conflict.digit}. Only the first is reachable — move the others to a free key.`,
      )
    }

    for (const choice of outgoing) {
      destOf.set(
        choice.id,
        emitDoor({
          graph,
          node,
          slug,
          choice,
          dkey: keyOf(choice),
          audioBaseUrl,
          widgets,
          warnings,
          gateByChoice,
          gateWidget,
          effectsFor,
          variablesFor,
          entryName,
          wname,
        }),
      )
    }

    // ---- one transition per KEY, not per door
    //
    // A duplicate digit is warned about above; here the first door simply wins,
    // deterministically, because the exporter has to emit something and a coin
    // toss would make the same story compile two ways.
    for (const [digit, doors] of byDigit) {
      keyTransitions.push({
        event: 'match',
        condition: `Digits equals ${digit}`,
        match: { type: 'equal_to', value: digit },
        next: destOf.get(doors[0].id) ?? wname(slug, 'gather'),
      })
    }

    // An explicit target is a room the caller ENTERS; the default is this room
    // replayed, which must not re-run its arrival effects.
    const nodeAt = (id: string | null) => (id ? graph.nodes.get(id) : null)
    const timeoutTarget = nodeAt(node.timeout_target_id)
      ? entryName(nodeAt(node.timeout_target_id)!)
      : replayName(node)
    const invalidTarget = nodeAt(node.invalid_target_id)
      ? entryName(nodeAt(node.invalid_target_id)!)
      : replayName(node)

    // The reserved key, if this story has one. It goes to a one-line widget
    // that records WHICH room to come back to — Studio has no return, so the
    // room has to leave itself a note on the way out.
    if (inventory && !collidingRooms.has(slug)) {
      keyTransitions.push({
        event: 'match',
        condition: `Digits equals ${inventory.key}`,
        match: { type: 'equal_to', value: inventory.key },
        next: invRetName(slug),
      })
      widgets.push({
        name: invRetName(slug),
        type: 'set-variables',
        nodeId: node.id,
        note: `Remember where to come back to, then read the satchel back.`,
        variables: [{ key: RET_VAR, value: slug }],
        transitions: [{ event: 'next', next: INV_START }],
      })
      returnsTo.push({ slug, next: replayName(node) })
    }

    // Studio's shape, not ours: a gather collects and hands off, and a split
    // decides. A gather-input-on-call accepts only keypress, speech and
    // timeout, and none of them may carry conditions — putting the per-digit
    // tests on the gather made the whole flow fail schema validation on import.
    widgets.push({
      name: wname(slug, 'gather'),
      type: 'gather-input-on-call',
      nodeId: node.id,
      note: `Stop gathering after 1 digit; ${node.timeout_seconds}s timeout.`,
      properties: gatherProperties(node.timeout_seconds),
      transitions: [
        { event: 'keypress', next: wname(slug, 'keys') },
        { event: 'speech', next: wname(slug, 'keys') },
        { event: 'timeout', next: timeoutTarget },
      ],
    })
    widgets.push({
      name: wname(slug, 'keys'),
      type: 'split-based-on',
      nodeId: node.id,
      note: 'Which key was pressed. Anything unlisted is a wrong keypress.',
      splitOn: `{{widgets.${wname(slug, 'gather')}.Digits}}`,
      transitions: [...keyTransitions, { event: 'noMatch', next: invalidTarget }],
    })

    if (outgoing.length === 0) {
      warnings.push(
        `${slug} is a room with no exits and is not an ending — a caller reaching it can only time out.`,
      )
    }
  }

  const root = graph.story.root_node_id ? graph.nodes.get(graph.story.root_node_id) : null

  // ---- the shared inventory readback (emitted once, not per room)
  if (inventory) {
    for (const room of collidingRooms) {
      warnings.push(
        `${room} already uses ${inventory.key} for a door, so the caller cannot check their satchel there. Move that door to another key, or change the readback key.`,
      )
    }
    for (const item of inventory.silent) {
      warnings.push(
        `${item.name || item.slug} has no recording of its name, so a caller holding it hears nothing for it in the readback.`,
      )
    }
    if (!inventory.introRecorded) {
      warnings.push(
        'The inventory lead-in has no recording, so the readback starts straight in on the items.',
      )
    }
    if (!inventory.emptyRecorded) {
      warnings.push(
        'There is no recording for empty hands, so a caller carrying nothing hears silence and is returned to the room.',
      )
    }
    if (returnsTo.length === 0) {
      warnings.push(
        `No room can reach the inventory readback on ${inventory.key}, so it is unreachable.`,
      )
    }

    // Where the items begin: the lead-in if it was recorded, otherwise the
    // first thing there is to say.
    const firstItem = inventory.spoken.length > 0 ? invItemCheck(inventory.spoken[0].slug) : INV_RETURN
    const afterIntro = inventory.introRecorded ? INV_INTRO : firstItem
    const whenEmpty = inventory.emptyRecorded ? INV_NONE : INV_RETURN

    widgets.push({
      name: INV_START,
      type: 'split-based-on',
      note: 'Empty hands get their own line rather than a lead-in and then nothing.',
      splitOn: emptyHandedCondition(),
      transitions: [
        {
          event: 'match',
          condition: 'equal_to |',
          match: { type: 'equal_to', value: '|' },
          next: whenEmpty,
        },
        { event: 'noMatch', next: afterIntro },
      ],
    })

    if (inventory.emptyRecorded) {
      widgets.push({
        name: INV_NONE,
        type: 'say-play',
        note: 'Carrying nothing.',
        playUrl: `${audioBaseUrl}${graph.story.inventory_empty_audio_path}`,
        transitions: [{ event: 'audioComplete', next: INV_RETURN }],
      })
    }
    if (inventory.introRecorded) {
      widgets.push({
        name: INV_INTRO,
        type: 'say-play',
        note: 'The lead-in: "you are carrying…".',
        playUrl: `${audioBaseUrl}${graph.story.inventory_intro_audio_path}`,
        transitions: [{ event: 'audioComplete', next: firstItem }],
      })
    }

    // One test and one line per recorded item, chained. An item nobody recorded
    // gets no widgets at all rather than a gap in the middle of the sentence.
    inventory.spoken.forEach((item, i) => {
      const after = inventory.spoken[i + 1] ? invItemCheck(inventory.spoken[i + 1].slug) : INV_RETURN
      widgets.push({
        name: invItemCheck(item.slug),
        type: 'split-based-on',
        note: `Is the caller holding ${item.name || item.slug}?`,
        splitOn: `{{ flow.variables.${INV_VAR} | default: "|" }}`,
        transitions: [
          {
            event: 'match',
            condition: `contains |${item.slug}|`,
            match: { type: 'contains', value: `|${item.slug}|` },
            next: invItemPlay(item.slug),
          },
          { event: 'noMatch', next: after },
        ],
      })
      widgets.push({
        name: invItemPlay(item.slug),
        type: 'say-play',
        note: `"${item.name || item.slug}"`,
        playUrl: `${audioBaseUrl}${item.audio_path}`,
        transitions: [{ event: 'audioComplete', next: after }],
      })
    })

    // Back where they were standing. The REPLAY, never the entry: re-running
    // arrival effects would grant the room's item again for looking in a bag.
    widgets.push({
      name: INV_RETURN,
      type: 'split-based-on',
      note: 'Back to the room the caller pressed the key in.',
      splitOn: `{{ flow.variables.${RET_VAR} }}`,
      transitions: [
        ...returnsTo.map((r) => ({
          event: 'match' as const,
          condition: `equal_to ${r.slug}`,
          match: { type: 'equal_to' as const, value: r.slug },
          next: r.next,
        })),
        // Only reachable if `ret` was never set, which cannot happen by any
        // route the exporter builds — but Studio needs somewhere to go.
        { event: 'noMatch', next: returnsTo[0]?.next ?? (root ? entryName(root) : '') },
      ],
    })
  }

  // ---- budget (§6.5)
  const total = widgets.length
  const longestPathSteps = estimateLongestPath(graph)

  return {
    widgets,
    warnings,
    budget: { total, limit: WIDGET_LIMIT, warn: total >= WIDGET_LIMIT * 0.8 },
    longestPathSteps,
    stepCapRisk: longestPathSteps >= STEP_LIMIT * 0.8,
    entryWidget: root ? entryName(root) : null,
  }
}

/** Fold several inventory changes into one chained Liquid expression, so they
 *  share a single `inv` key rather than colliding. */
function chainedInventoryLiquid(ops: Array<{ slug: string; revoke: boolean }>): string {
  let expr = `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}`
  for (const op of ops) {
    expr += op.revoke
      ? `{% assign cur = cur | replace: "|${op.slug}|", "|" %}`
      : `{% unless cur contains "|${op.slug}|" %}{% assign cur = cur | append: "${op.slug}|" %}{% endunless %}`
  }
  return `${expr}{{ cur }}`
}

/**
 * §6.5's step-depth check. The 1,000-step cap applies to a single call, so what
 * matters is the longest route a caller could take, at roughly 3–4 steps per
 * room once gates and effects are counted.
 *
 * Longest *simple* path is NP-hard in general, so this is a bounded DFS that
 * stops at the cap: the only question worth answering is "could a route exhaust
 * 1,000 steps", not exactly how long the worst one is.
 */
function estimateLongestPath(graph: StoryGraph): number {
  const root = graph.story.root_node_id
  if (!root) return 0
  const STEPS_PER_NODE = 4
  const children = new Map<string, string[]>()
  for (const e of graphEdges(graph)) {
    if (!e.to_node_id) continue
    if (!children.has(e.from_node_id)) children.set(e.from_node_id, [])
    children.get(e.from_node_id)!.push(e.to_node_id)
  }

  let best = 0
  const cap = Math.ceil((STEP_LIMIT * 1.5) / STEPS_PER_NODE)
  const stack: Array<{ id: string; depth: number; seen: Set<string> }> = [
    { id: root, depth: 1, seen: new Set([root]) },
  ]
  let visits = 0
  while (stack.length) {
    if (++visits > 200_000) break // bounded work; this is a warning, not a proof
    const { id, depth, seen } = stack.pop()!
    best = Math.max(best, depth)
    if (depth >= cap) break
    for (const next of children.get(id) ?? []) {
      if (seen.has(next)) continue // simple path: no repeats
      const nextSeen = new Set(seen)
      nextSeen.add(next)
      stack.push({ id: next, depth: depth + 1, seen: nextSeen })
    }
  }
  return best * STEPS_PER_NODE
}
