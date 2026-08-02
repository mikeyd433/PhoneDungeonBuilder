import type { StoryGraph } from '@/types/domain'
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

  for (const node of nodes) {
    const slug = node.slug
    const outgoing = choicesFrom(node.id)
    const gated = outgoing.filter((c) => gateByChoice.has(c.id))

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
    let say = node.narration
    if (hideGated.length > 0) {
      // §6.3: a hidden choice simply isn't spoken. Wrapping each hidden line in
      // a Liquid conditional costs no extra widget.
      const lines = hideGated
        .map(
          (c) =>
            `{% if flow.variables.${gateVarName(slug, c.digit)} == "pass" %} Press ${c.digit} to ${c.label}.{% endif %}`,
        )
        .join('')
      say = `${node.narration}${lines}`
    }

    widgets.push({
      name: playName(slug),
      type: 'say-play',
      nodeId: node.id,
      note: node.audio_path ? 'Play the recorded audio.' : 'No audio yet — Studio will speak this.',
      say: node.audio_path ? undefined : say,
      playUrl: node.audio_path ? `${audioBaseUrl}${node.audio_path}` : undefined,
      transitions: [
        { event: 'audioComplete', next: node.node_type === 'ending' ? wname(slug, 'hangup') : wname(slug, 'gather') },
      ],
    })

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
  for (const c of graph.choices.values()) {
    if (!c.to_node_id) continue
    if (!children.has(c.from_node_id)) children.set(c.from_node_id, [])
    children.get(c.from_node_id)!.push(c.to_node_id)
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
