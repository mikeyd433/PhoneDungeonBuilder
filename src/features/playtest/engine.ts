import type { Choice, StoryGraph } from '@/types/domain'
import {
  applyEffects,
  buildVarIndex,
  emptyState,
  evaluate,
  referencedVars,
  type CallerState,
  type EffectLike,
  type VarIndex,
} from '@/features/state/expression'

/**
 * The playtest runtime (§4.4) — the same data, seen as the caller sees it.
 *
 * Deliberately reuses the solver's expression evaluator and effect application
 * rather than reimplementing them. If playtest and the solver disagreed about
 * what a gate means, one of them would be lying, and the bug would only surface
 * on the phone.
 */

export interface OfferedChoice {
  choice: Choice
  /** Whether the gate passes right now. */
  open: boolean
  /** Spoken to the caller. A `hide` gate that fails is not offered at all. */
  label: string
  gate: {
    failBehavior: 'hide' | 'refuse' | 'divert'
    failNarration: string | null
    failNodeId: string | null
    consumeOnPass: boolean
  } | null
}

export interface PlaytestState {
  nodeId: string
  caller: CallerState
  /** Slugs visited, in order — the exportable path log (F5.6). */
  path: string[]
  /** Consecutive failed attempts at this node, for the patience valve (§6.3). */
  failedAttempts: number
  finished: boolean
}

export class PlaytestEngine {
  readonly index: VarIndex
  private graph: StoryGraph

  constructor(graph: StoryGraph) {
    this.graph = graph
    this.index = buildVarIndex(
      [...graph.stateVars.values()].map((v) => ({ slug: v.slug, kind: v.kind })),
      graph.story.counter_clamp,
    )
  }

  start(): PlaytestState {
    const rootId = this.graph.story.root_node_id
    const node = rootId ? this.graph.nodes.get(rootId) : undefined
    if (!rootId || !node) {
      return { nodeId: '', caller: emptyState(this.index), path: [], failedAttempts: 0, finished: true }
    }
    return {
      nodeId: rootId,
      caller: applyEffects(emptyState(this.index), this.nodeEffects(rootId), this.index),
      path: [node.slug],
      failedAttempts: 0,
      finished: node.node_type === 'ending',
    }
  }

  private nodeEffects(nodeId: string): EffectLike[] {
    return this.effectsWhere((e) => e.node_id === nodeId)
  }

  private choiceEffects(choiceId: string): EffectLike[] {
    return this.effectsWhere((e) => e.choice_id === choiceId)
  }

  private effectsWhere(predicate: (e: { node_id: string | null; choice_id: string | null }) => boolean) {
    return [...this.graph.effects.values()]
      .filter(predicate)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map<EffectLike>((e) => ({
        varSlug: this.graph.stateVars.get(e.state_var_id)?.slug ?? '',
        operation: e.operation,
        amount: e.amount,
      }))
      .filter((e) => e.varSlug)
  }

  /** What the caller is offered here, in digit order. */
  offered(state: PlaytestState): OfferedChoice[] {
    const out: OfferedChoice[] = []
    for (const choice of this.graph.choices.values()) {
      if (choice.from_node_id !== state.nodeId) continue
      const gate = [...this.graph.gates.values()].find((g) => g.choice_id === choice.id)
      const open = gate ? evaluate(gate.expression, state.caller, this.index) : true

      // A failed `hide` gate isn't read aloud at all — the door isn't there.
      if (gate && !open && gate.fail_behavior === 'hide') continue

      out.push({
        choice,
        open,
        label: choice.label,
        gate: gate
          ? {
              failBehavior: gate.fail_behavior,
              failNarration: gate.fail_narration,
              failNodeId: gate.fail_node_id,
              consumeOnPass: gate.consume_on_pass,
            }
          : null,
      })
    }
    return out.sort((a, b) => a.choice.sort_order - b.choice.sort_order)
  }

  /**
   * Press a digit. Returns the next state plus anything the caller hears on the
   * way — a refusal has narration of its own before they land back here.
   */
  press(state: PlaytestState, digit: string): { next: PlaytestState; spoken: string | null } {
    const offer = this.offered(state).find((o) => o.choice.digit === digit)

    if (!offer) {
      // F5.4's sibling: a wrong keypress goes to invalid_target_id, or repeats.
      const node = this.graph.nodes.get(state.nodeId)
      const target = node?.invalid_target_id
      if (target && this.graph.nodes.has(target)) return this.enter(state, target)
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        spoken: "That isn't one of the options.",
      }
    }

    if (!offer.open && offer.gate) {
      if (offer.gate.failBehavior === 'divert' && offer.gate.failNodeId) {
        return this.enter(state, offer.gate.failNodeId)
      }
      // `refuse` — say why, and stay put.
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        spoken: offer.gate.failNarration ?? "You can't do that yet.",
      }
    }

    let caller = state.caller

    // F8.9 — spend the consumable that opened the gate.
    if (offer.gate?.consumeOnPass) {
      const gate = [...this.graph.gates.values()].find((g) => g.choice_id === offer.choice.id)
      const consumed = referencedVars(gate?.expression)
        .filter((slug) => {
          const v = [...this.graph.stateVars.values()].find((x) => x.slug === slug)
          return v?.is_consumable
        })
        .map<EffectLike>((slug) => ({ varSlug: slug, operation: 'revoke', amount: null }))
      caller = applyEffects(caller, consumed, this.index)
    }

    caller = applyEffects(caller, this.choiceEffects(offer.choice.id), this.index)

    if (!offer.choice.to_node_id) {
      return {
        next: { ...state, caller, failedAttempts: 0 },
        spoken: '(This branch is unwritten — nothing happens.)',
      }
    }
    return this.enter({ ...state, caller }, offer.choice.to_node_id)
  }

  /** F5.4 — the caller said nothing in time. */
  timeout(state: PlaytestState): { next: PlaytestState; spoken: string | null } {
    const node = this.graph.nodes.get(state.nodeId)
    const target = node?.timeout_target_id
    if (target && this.graph.nodes.has(target)) return this.enter(state, target)
    // Null means "repeat this node" (§4.2's default).
    return { next: { ...state, failedAttempts: state.failedAttempts + 1 }, spoken: null }
  }

  private enter(state: PlaytestState, nodeId: string): { next: PlaytestState; spoken: string | null } {
    const node = this.graph.nodes.get(nodeId)
    if (!node) return { next: state, spoken: null }
    const caller = applyEffects(state.caller, this.nodeEffects(nodeId), this.index)
    return {
      next: {
        nodeId,
        caller,
        path: [...state.path, node.slug],
        failedAttempts: 0,
        finished: node.node_type === 'ending',
      },
      spoken: null,
    }
  }

  /** Slugs the caller is currently holding, for the live inventory row (F5.3). */
  held(state: PlaytestState): string[] {
    const out: string[] = []
    for (const v of this.graph.stateVars.values()) {
      if (v.kind === 'counter') {
        const slot = this.index.counter.get(v.slug)
        const n = slot !== undefined ? (state.caller.counters[slot] ?? 0) : 0
        if (n > 0) out.push(`${v.slug} ×${n}`)
      } else {
        const bit = this.index.bit.get(v.slug)
        if (bit !== undefined && (state.caller.mask & (1 << bit)) !== 0) out.push(v.slug)
      }
    }
    return out
  }
}
