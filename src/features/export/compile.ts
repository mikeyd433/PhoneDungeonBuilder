import type { StoryGraph } from '@/types/domain'
import { graphEdges } from '@/features/graph/edges'
import { playbackFor } from '@/features/cast/dialogue'
import {
  fightProblems,
  fightsByNode,
  movesOf,
  MAX_FIGHT_MOVES,
  outcomesOf,
  resolveMiss,
  resolveMove,
  roundsOf,
} from '@/features/fight/model'
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
  | 'hangup'

export interface Transition {
  event: string
  /** Condition label for split/gather transitions. */
  condition?: string
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
}

/** §6.0 — 2,000 widgets across the parent flow and all linked subflows. */
export const WIDGET_LIMIT = 2000
/** §6.0 — an execution ends after 1,000 steps. */
export const STEP_LIMIT = 1000
/**
 * §6.3 — Studio kills an execution if the same widget runs 10 times in a row,
 * so a caller mashing a locked door gets hung up on. Route the 8th failure to
 * an escape instead. The spec calls this a "patience valve".
 */
export const PATIENCE_VALVE_AT = 8

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

  const playName = (slug: string) => wname(slug, 'play')

  /** A fight's round widgets: `SHARKS_r1_play` then `SHARKS_r1_gather`. */
  const roundName = (slug: string, index: number, part: 'play' | 'gather') =>
    `${slug}_r${index + 1}_${part}`

  /**
   * Where a fight outcome leads. An outcome with nowhere set falls back to the
   * fight's own room, so the flow is still connected — the warning is what tells
   * the author it needs finishing, not a dangling transition Studio would refuse
   * to import.
   */
  const fightOutcome = (targetId: string | null, fallbackSlug: string) =>
    playName(targetId ? (graph.nodes.get(targetId)?.slug ?? fallbackSlug) : fallbackSlug)

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
    let entry = playName(slug)
    if (arrival.length > 0) {
      entry = wname(slug, 'fx')
      widgets.push({
        name: entry,
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
        transitions: [{ event: 'next', next: playName(slug) }],
      })
      if (arrival.length > 0) {
        widgets.find((w) => w.name === wname(slug, 'fx'))!.transitions = [
          { event: 'next', next: gateWidget },
        ]
      }
      entry = arrival.length > 0 ? wname(slug, 'fx') : gateWidget
    } else if (arrival.length > 0) {
      widgets.find((w) => w.name === wname(slug, 'fx'))!.transitions = [
        { event: 'next', next: playName(slug) },
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
    const roomExit = () => {
      if (node.node_type === 'ending') return wname(slug, 'hangup')
      if (!fight) return wname(slug, 'gather')
      return rounds.length > 0 ? `${slug}_reset` : fightOutcome(fight.win_node_id, slug)
    }

    // The room's audio. Usually one widget; a conversation assembled from
    // separately-booked actors is one widget per line, played back to back and
    // landing on the same exit — which is what makes "hold the conversation,
    // then offer the choice" a single room rather than a chain of them.
    const parts = playbackFor(graph, node.id)
    const partName = (i: number) => (i === 0 ? playName(slug) : `${slug}_line${i + 1}`)

    parts.forEach((part, i) => {
      const last = i === parts.length - 1
      // Hidden choices are appended to whatever is read last, so the Liquid
      // conditional still runs immediately before the gather.
      const text = last ? `${part.say}${hiddenLines}` : part.say
      widgets.push({
        name: partName(i),
        type: 'say-play',
        nodeId: node.id,
        note: part.audioPath
          ? `Play the recorded audio.${part.speaker ? ` — ${part.speaker}` : ''}`
          : `No audio yet — Studio will speak this.${part.speaker ? ` — ${part.speaker}` : ''}`,
        say: part.audioPath ? undefined : text,
        playUrl: part.audioPath ? `${audioBaseUrl}${part.audioPath}` : undefined,
        transitions: [{ event: 'audioComplete', next: last ? roomExit() : partName(i + 1) }],
      })
    })

    if (parts.length > 1) {
      // A hidden choice is spoken by a Liquid conditional inside a Say widget,
      // and a Play widget has no text to hide it in. Silently dropping the line
      // would make the door invisible on the phone but present in the editor.
      const lastPart = parts[parts.length - 1]
      if (hiddenLines && lastPart.audioPath) {
        warnings.push(
          `${slug} hides ${hideGated.length} choice(s) behind a gate, but its last line is recorded audio — a hidden choice can only be spoken by a Say widget, so it will never be offered.`,
        )
      }
      const unrecorded = parts.filter((p) => !p.audioPath).length
      if (unrecorded > 0) {
        warnings.push(
          `${slug} plays line by line but ${unrecorded} of its ${parts.length} lines have no take — those will be read by Studio's voice in the middle of the scene.`,
        )
      }
    }

    if (node.node_type === 'ending') {
      widgets.push({
        name: wname(slug, 'hangup'),
        type: 'hangup',
        nodeId: node.id,
        note: 'The way ends here.',
        transitions: [],
      })
      continue
    }

    // ---- a fight: two widgets per round, and no gather for the room itself
    if (fight) {
      const view = { fight, moves, rounds, outcomes }
      const missNext = fightOutcome(resolveMiss(view), slug)

      rounds.forEach((round, i) => {
        widgets.push({
          name: roundName(slug, i, 'play'),
          type: 'say-play',
          nodeId: node.id,
          note: `Round ${i + 1}: ${fight.opponent_name} throws ${round.opponent_move || '(nothing set)'}.`,
          say: round.narration || `${fight.opponent_name}: ${round.opponent_move}`,
          transitions: [{ event: 'audioComplete', next: roundName(slug, i, 'gather') }],
        })

        // One transition per move — a round is a room where you pick an exit,
        // so each digit gets named its own destination and several may share
        // one. Where each goes is resolveMove's call, the same function the
        // playtest runtime asks, so the phone cannot disagree with the editor.
        const roundTransitions: Transition[] = []
        const legend: string[] = []

        moves.slice(0, MAX_FIGHT_MOVES).forEach((move, m) => {
          const outcome = resolveMove(view, i, move.id)
          const next =
            outcome.via === 'advance' && outcome.nextRound !== null
              ? roundName(slug, outcome.nextRound, 'play')
              : fightOutcome(outcome.nodeId, slug)
          roundTransitions.push({
            event: 'keypress',
            condition: `Digits equals ${m + 1}`,
            next,
          })
          legend.push(`${m + 1}=${move.slug}`)
        })

        // An unmapped digit is an answer, and it is the wrong one.
        roundTransitions.push({ event: 'noMatch', next: missNext })
        // Silence is not. Callers hesitate, mishear, or are still working out
        // which digit is which, so the round repeats a few times before the
        // fight is called — through a counter, because routing timeout straight
        // back at the round would run one widget in a loop and Studio ends an
        // execution after ten consecutive runs of the same widget (§6.0).
        roundTransitions.push({ event: 'timeout', next: `${slug}_r${i + 1}_waited` })

        widgets.push({
          name: roundName(slug, i, 'gather'),
          type: 'gather-input-on-call',
          nodeId: node.id,
          note:
            legend.length > 0
              ? `${legend.join(', ')}. Any other digit, and silence, takes the losing route.`
              : 'This round has no moves — every answer takes the losing route.',
          transitions: roundTransitions,
        })

        // Silence handling: count it, then either repeat the round or call it.
        const silenceVar = `${slug}_r${i + 1}_silence`
        widgets.push({
          name: `${slug}_r${i + 1}_waited`,
          type: 'set-variables',
          nodeId: node.id,
          note: 'The caller said nothing. Count it.',
          variables: [
            {
              key: silenceVar,
              value: `{{ flow.variables.${silenceVar} | default: 0 | plus: 1 }}`,
            },
          ],
          transitions: [{ event: 'next', next: `${slug}_r${i + 1}_patience` }],
        })
        widgets.push({
          name: `${slug}_r${i + 1}_patience`,
          type: 'split-based-on',
          nodeId: node.id,
          note: `Repeat the round up to ${fight.silence_patience} times, then the fight is called.`,
          splitOn: `{{flow.variables.${silenceVar}}}`,
          transitions: [
            {
              event: 'match',
              condition: `Less than ${fight.silence_patience}`,
              next: roundName(slug, i, 'play'),
            },
            { event: 'noMatch', next: missNext },
          ],
        })
      })

      // The counters live for the whole call, so a fight re-entered by a loop
      // would start already out of patience. Zero them on the way in.
      if (rounds.length > 0) {
        widgets.push({
          name: `${slug}_reset`,
          type: 'set-variables',
          nodeId: node.id,
          note: 'Clear the silence counters, so re-entering this fight starts fresh.',
          variables: rounds.map((_, i) => ({ key: `${slug}_r${i + 1}_silence`, value: '0' })),
          transitions: [{ event: 'next', next: roundName(slug, 0, 'play') }],
        })
      }

      for (const problem of fightProblems(view)) {
        warnings.push(`${slug}: ${problem}`)
      }
      if (outgoing.length > 0) {
        warnings.push(
          `${slug} is a fight but also has ${outgoing.length} exit(s). A fight decides where the caller goes, so those doors are not exported.`,
        )
      }
      continue
    }

    // ---- gather
    const transitions: Transition[] = []
    for (const choice of outgoing) {
      const gate = gateByChoice.get(choice.id)
      const fx = effectsFor((e) => e.choice_id === choice.id)
      const target = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null

      // Where this digit ultimately lands, before any gate split.
      let dest: string | null = target ? playName(target.slug) : null
      if (!target) {
        warnings.push(
          `${slug} digit ${choice.digit} ("${choice.label}") is an unwritten branch — it has nowhere to go and is exported as a repeat.`,
        )
        dest = wname(slug, 'gather')
      }

      // Choice effects: one widget, only if there is something to do (§6.2 —
      // "Don't pay widgets for nothing").
      if (fx.length > 0) {
        const fxName = `${slug}_d${digitToken(choice.digit)}_fx`
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
        const splitName = `${slug}_d${digitToken(choice.digit)}_gate`
        const failNext =
          gate.fail_behavior === 'divert'
            ? gate.fail_node_id
              ? playName(graph.nodes.get(gate.fail_node_id)?.slug ?? slug)
              : wname(slug, 'gather')
            : `${slug}_d${digitToken(choice.digit)}_refuse`

        widgets.push({
          name: splitName,
          type: 'split-based-on',
          nodeId: node.id,
          note: `Gate on digit ${choice.digit}; the boolean was computed in ${gateWidget}.`,
          splitOn: `{{flow.variables.${gateVarName(slug, choice.digit)}}}`,
          transitions: [
            { event: 'match', condition: 'Equal To pass', next: dest },
            { event: 'noMatch', next: failNext },
          ],
        })

        if (gate.fail_behavior === 'refuse') {
          widgets.push({
            name: failNext,
            type: 'say-play',
            nodeId: node.id,
            note:
              'Refusal. Returns to the GATHER, not the play widget, so the caller ' +
              `doesn't re-hear the whole scene. Route the ${PATIENCE_VALVE_AT}th attempt to an escape.`,
            say: gate.fail_narration ?? "You can't do that yet.",
            transitions: [{ event: 'audioComplete', next: wname(slug, 'gather') }],
          })
        }
        dest = splitName
      }

      transitions.push({ event: 'keypress', condition: `Digits equals ${choice.digit}`, next: dest })
    }

    const timeoutTarget = node.timeout_target_id
      ? playName(graph.nodes.get(node.timeout_target_id)?.slug ?? slug)
      : playName(slug)
    const invalidTarget = node.invalid_target_id
      ? playName(graph.nodes.get(node.invalid_target_id)?.slug ?? slug)
      : playName(slug)

    transitions.push({ event: 'timeout', next: timeoutTarget })
    transitions.push({ event: 'noMatch', next: invalidTarget })

    widgets.push({
      name: wname(slug, 'gather'),
      type: 'gather-input-on-call',
      nodeId: node.id,
      note: `Stop gathering after 1 digit; ${node.timeout_seconds}s timeout.`,
      transitions,
    })

    if (outgoing.length === 0) {
      warnings.push(
        `${slug} is a room with no exits and is not an ending — a caller reaching it can only time out.`,
      )
    }
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
