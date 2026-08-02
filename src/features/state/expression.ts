import type { GateExpression } from '@/types/domain'

/**
 * A caller's state at a point in the story.
 *
 * Items and flags are bit positions in a single 32-bit integer (§7), so set
 * operations are one CPU instruction. Counters can't be bits, so they ride
 * alongside as a small array indexed the same way — and they MUST be clamped,
 * or the state space is infinite and the solver never terminates.
 */
export interface CallerState {
  /** Bitmask of held items/flags. */
  mask: number
  /** Counter values, indexed by counter slot. */
  counters: number[]
}

/** 32 bit positions in one int — §7's stated ceiling, and a real one. */
export const MAX_BIT_VARS = 32

/** Maps a story's state var slugs onto bit positions and counter slots. */
export interface VarIndex {
  /** slug -> bit position, for items and flags. */
  bit: Map<string, number>
  /** slug -> counter slot, for counters. */
  counter: Map<string, number>
  /** Counter values saturate here so the state space stays finite (§11.5). */
  clamp: number
}

export function buildVarIndex(
  vars: Array<{ slug: string; kind: 'item' | 'flag' | 'counter' }>,
  clamp: number,
): VarIndex {
  const bit = new Map<string, number>()
  const counter = new Map<string, number>()
  for (const v of vars) {
    if (v.kind === 'counter') {
      if (!counter.has(v.slug)) counter.set(v.slug, counter.size)
    } else if (!bit.has(v.slug)) {
      bit.set(v.slug, bit.size)
    }
  }
  return { bit, counter, clamp }
}

export function emptyState(index: VarIndex): CallerState {
  return { mask: 0, counters: new Array(index.counter.size).fill(0) }
}

/** A stable key for deduping states in a node's set. */
export function stateKey(state: CallerState): string {
  return state.counters.length > 0
    ? `${state.mask}|${state.counters.join(',')}`
    : String(state.mask)
}

export function hasVar(state: CallerState, index: VarIndex, slug: string): boolean {
  const bit = index.bit.get(slug)
  if (bit === undefined) return false
  return (state.mask & (1 << bit)) !== 0
}

function counterValue(state: CallerState, index: VarIndex, slug: string): number {
  const slot = index.counter.get(slug)
  if (slot === undefined) return 0
  return state.counters[slot] ?? 0
}

/**
 * Evaluate a gate expression against a state.
 *
 * An empty `and` is true (nothing is required) and an empty `or` is false —
 * the standard identities. This matters because the gate builder starts every
 * new gate as `{op:'and',args:[]}`, and a gate with no conditions yet must not
 * lock the door.
 */
export function evaluate(
  expression: GateExpression | null | undefined,
  state: CallerState,
  index: VarIndex,
): boolean {
  if (!expression) return true
  switch (expression.op) {
    case 'has':
      return hasVar(state, index, expression.var)
    case 'lacks':
      return !hasVar(state, index, expression.var)
    case 'gte':
      return counterValue(state, index, expression.var) >= expression.value
    case 'lte':
      return counterValue(state, index, expression.var) <= expression.value
    case 'eq':
      return counterValue(state, index, expression.var) === expression.value
    case 'and':
      return expression.args.every((a) => evaluate(a, state, index))
    case 'or':
      return expression.args.some((a) => evaluate(a, state, index))
    case 'not':
      return !evaluate(expression.args[0], state, index)
    default:
      return true
  }
}

/** Every state var slug an expression mentions. */
export function referencedVars(expression: GateExpression | null | undefined): string[] {
  if (!expression) return []
  switch (expression.op) {
    case 'has':
    case 'lacks':
    case 'gte':
    case 'lte':
    case 'eq':
      return [expression.var]
    case 'and':
    case 'or':
      return expression.args.flatMap(referencedVars)
    case 'not':
      return referencedVars(expression.args[0])
    default:
      return []
  }
}

export interface EffectLike {
  varSlug: string
  operation: 'grant' | 'revoke' | 'set' | 'add'
  amount: number | null
}

/** Apply effects in order, returning a new state. Never mutates the input. */
export function applyEffects(
  state: CallerState,
  effects: EffectLike[],
  index: VarIndex,
): CallerState {
  let mask = state.mask
  const counters = [...state.counters]

  for (const effect of effects) {
    const bit = index.bit.get(effect.varSlug)
    const slot = index.counter.get(effect.varSlug)

    if (bit !== undefined) {
      if (effect.operation === 'grant') mask |= 1 << bit
      else if (effect.operation === 'revoke') mask &= ~(1 << bit)
      continue
    }
    if (slot === undefined) continue

    const current = counters[slot] ?? 0
    let next = current
    if (effect.operation === 'add') next = current + (effect.amount ?? 0)
    else if (effect.operation === 'set') next = effect.amount ?? 0
    else if (effect.operation === 'grant') next = current + 1
    else if (effect.operation === 'revoke') next = current - 1

    // Saturating clamp — §7 and §11.5. Without this the solver would generate
    // an unbounded number of distinct states and never reach a fixed point.
    counters[slot] = Math.max(0, Math.min(index.clamp, next))
  }

  return { mask, counters }
}
