import type { GateExpression } from '@/types/domain'
import {
  applyEffects,
  buildVarIndex,
  emptyState,
  evaluate,
  hasVar,
  referencedVars,
  stateKey,
  type CallerState,
  type EffectLike,
  type VarIndex,
} from './expression'

/**
 * The state solver (§7).
 *
 * A branching story with items develops bugs a human cannot see: a gate at depth
 * 12 requiring an item only obtainable on a path that can't reach depth 12. This
 * walks every reachable inventory state and tells you.
 *
 * Fixed-point worklist iteration. Every node holds the set of inventory states a
 * caller could arrive with; a node is reprocessed whenever its set grows.
 * Cycles are handled for free — the set stops growing, so iteration halts.
 *
 * The input is a plain serialisable snapshot rather than the live StoryGraph,
 * because this runs inside a Web Worker and Maps of rich objects would have to
 * cross the structured-clone boundary anyway.
 */

export interface SolverVar {
  slug: string
  kind: 'item' | 'flag' | 'counter'
  isConsumable: boolean
}

export interface SolverChoice {
  id: string
  fromId: string
  toId: string | null
  digit: string
  effects: EffectLike[]
  gate: {
    expression: GateExpression
    failBehavior: 'hide' | 'refuse' | 'divert'
    failNodeId: string | null
    consumeOnPass: boolean
  } | null
}

export interface SolverNode {
  id: string
  slug: string
  isEnding: boolean
  /** Node-level effects fire on arrival (§2). */
  effects: EffectLike[]
}

export interface SolverInput {
  rootId: string | null
  nodes: SolverNode[]
  choices: SolverChoice[]
  vars: SolverVar[]
  counterClamp: number
  /** Guards a pathological story from hanging the worker. */
  maxStatesPerNode?: number
}

export type Availability = 'guaranteed' | 'possible' | 'impossible'

export interface SolverFinding {
  kind: 'dead-gate' | 'unreachable' | 'orphan-item' | 'unobtainable-item' | 'consumable-softlock'
  /** Human-readable, already phrased for the ledger. */
  message: string
  nodeId?: string
  choiceId?: string
  varSlug?: string
}

export interface SolverResult {
  /** node id -> var slug -> availability on arrival (F8.6). */
  availability: Record<string, Record<string, Availability>>
  /** node id -> number of distinct arrival states, for diagnostics. */
  stateCount: Record<string, number>
  findings: SolverFinding[]
  /** True when a cap was hit and the answer is therefore approximate. */
  truncated: boolean
}

const DEFAULT_MAX_STATES = 4096

export function solve(input: SolverInput): SolverResult {
  const index: VarIndex = buildVarIndex(input.vars, input.counterClamp)
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]))
  const outgoing = new Map<string, SolverChoice[]>()
  for (const node of input.nodes) outgoing.set(node.id, [])
  for (const choice of input.choices) outgoing.get(choice.fromId)?.push(choice)

  const maxStates = input.maxStatesPerNode ?? DEFAULT_MAX_STATES
  let truncated = false

  /** node id -> key -> state */
  const arrivals = new Map<string, Map<string, CallerState>>()
  for (const node of input.nodes) arrivals.set(node.id, new Map())

  /** Choices observed to pass their gate at least once, for dead-gate detection. */
  const gatePassed = new Set<string>()

  const worklist: string[] = []
  const queued = new Set<string>()

  const push = (id: string) => {
    if (!queued.has(id)) {
      queued.add(id)
      worklist.push(id)
    }
  }

  /** Add a state to a node's arrival set; returns true if it was new. */
  const addArrival = (nodeId: string, state: CallerState): boolean => {
    const set = arrivals.get(nodeId)
    if (!set) return false
    if (set.size >= maxStates) {
      truncated = true
      return false
    }
    const key = stateKey(state)
    if (set.has(key)) return false
    set.set(key, state)
    return true
  }

  // The root's own arrival effects fire before anything else — a story can grant
  // a starting item on the entrance node.
  if (input.rootId && nodeById.has(input.rootId)) {
    const root = nodeById.get(input.rootId)!
    addArrival(input.rootId, applyEffects(emptyState(index), root.effects, index))
    push(input.rootId)
  }

  let guard = 0
  const GUARD_LIMIT = 2_000_000

  while (worklist.length > 0) {
    if (++guard > GUARD_LIMIT) {
      truncated = true
      break
    }
    const nodeId = worklist.shift()!
    queued.delete(nodeId)

    const node = nodeById.get(nodeId)
    if (!node || node.isEnding) continue // an ending has no exits to explore

    const states = [...(arrivals.get(nodeId)?.values() ?? [])]

    for (const choice of outgoing.get(nodeId) ?? []) {
      for (const state of states) {
        const passes = choice.gate ? evaluate(choice.gate.expression, state, index) : true

        let targetId: string | null = null
        let working = state

        if (passes) {
          if (choice.gate) {
            gatePassed.add(choice.id)
            // F8.9 — a consumable spent to pass a gate is revoked as it opens.
            if (choice.gate.consumeOnPass) {
              const consumed = referencedVars(choice.gate.expression)
                .filter((slug) => input.vars.find((v) => v.slug === slug)?.isConsumable)
                .map<EffectLike>((slug) => ({ varSlug: slug, operation: 'revoke', amount: null }))
              working = applyEffects(working, consumed, index)
            }
          }
          working = applyEffects(working, choice.effects, index)
          targetId = choice.toId
        } else if (choice.gate?.failBehavior === 'divert') {
          // A failed divert still moves the caller — that is the whole point of
          // a trap — but the choice's own effects do NOT fire.
          targetId = choice.gate.failNodeId
        } else {
          // hide / refuse leave the caller where they are, with state untouched.
          continue
        }

        if (!targetId) continue
        const target = nodeById.get(targetId)
        if (!target) continue

        const onArrival = applyEffects(working, target.effects, index)
        if (addArrival(targetId, onArrival)) push(targetId)
      }
    }
  }

  // ---------------------------------------------------------------- report

  const availability: Record<string, Record<string, Availability>> = {}
  const stateCount: Record<string, number> = {}
  const allSlugs = input.vars.map((v) => v.slug)

  for (const node of input.nodes) {
    const states = [...(arrivals.get(node.id)?.values() ?? [])]
    stateCount[node.id] = states.length
    const row: Record<string, Availability> = {}
    for (const slug of allSlugs) {
      if (states.length === 0) {
        row[slug] = 'impossible' // the node itself is unreachable
        continue
      }
      const holds = states.map((s) => held(s, index, slug, input))
      row[slug] = holds.every(Boolean)
        ? 'guaranteed'
        : holds.some(Boolean)
          ? 'possible'
          : 'impossible'
    }
    availability[node.id] = row
  }

  const findings: SolverFinding[] = []

  for (const node of input.nodes) {
    if (stateCount[node.id] === 0 && node.id !== input.rootId) {
      findings.push({
        kind: 'unreachable',
        nodeId: node.id,
        message: `${node.slug} can never be reached — no path from the entrance arrives here.`,
      })
    }
  }

  // F8.7 — a gate no reachable state can satisfy is a door that never opens.
  for (const choice of input.choices) {
    if (!choice.gate) continue
    if (gatePassed.has(choice.id)) continue
    const from = nodeById.get(choice.fromId)
    if (!from || stateCount[choice.fromId] === 0) continue // unreachable is its own finding
    findings.push({
      kind: 'dead-gate',
      choiceId: choice.id,
      nodeId: choice.fromId,
      message: `The gate on ${from.slug} digit ${choice.digit} can never be satisfied — no caller can arrive holding what it asks for.`,
    })
  }

  // F8.8 — items granted but never required, or required but never granted.
  const grantedVars = new Set<string>()
  const requiredVars = new Set<string>()
  for (const choice of input.choices) {
    for (const e of choice.effects) {
      if (e.operation !== 'revoke') grantedVars.add(e.varSlug)
    }
    for (const slug of referencedVars(choice.gate?.expression)) requiredVars.add(slug)
  }
  for (const node of input.nodes) {
    for (const e of node.effects) {
      if (e.operation !== 'revoke') grantedVars.add(e.varSlug)
    }
  }
  for (const v of input.vars) {
    if (requiredVars.has(v.slug) && !grantedVars.has(v.slug)) {
      findings.push({
        kind: 'unobtainable-item',
        varSlug: v.slug,
        message: `${v.slug} is required by a gate but nothing ever grants it.`,
      })
    } else if (grantedVars.has(v.slug) && !requiredVars.has(v.slug)) {
      findings.push({
        kind: 'orphan-item',
        varSlug: v.slug,
        message: `${v.slug} can be picked up but nothing ever asks for it.`,
      })
    }
  }

  return { availability, stateCount, findings, truncated }
}

function held(
  state: CallerState,
  index: VarIndex,
  slug: string,
  input: SolverInput,
): boolean {
  const isCounter = input.vars.find((v) => v.slug === slug)?.kind === 'counter'
  if (!isCounter) return hasVar(state, index, slug)
  const slot = index.counter.get(slug)
  return slot !== undefined && (state.counters[slot] ?? 0) > 0
}
