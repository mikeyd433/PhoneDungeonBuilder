import { describe, expect, it } from 'vitest'
import type { GateExpression } from '@/types/domain'
import { solve, type SolverChoice, type SolverInput, type SolverNode } from './solver'

/** Compact builders so the tests read as stories, not as fixtures. */
const node = (id: string, extra: Partial<SolverNode> = {}): SolverNode => ({
  id,
  slug: id,
  isEnding: false,
  effects: [],
  redirects: [],
  ...extra,
})

const choice = (
  id: string,
  fromId: string,
  toId: string | null,
  extra: Partial<SolverChoice> = {},
): SolverChoice => ({
  id,
  fromId,
  toId,
  digit: '1',
  effects: [],
  gate: null,
  ...extra,
})

const grant = (varSlug: string) => [{ varSlug, operation: 'grant' as const, amount: null }]
const has = (v: string): GateExpression => ({ op: 'has', var: v })

function input(partial: Partial<SolverInput>): SolverInput {
  return {
    rootId: 'A',
    nodes: [],
    choices: [],
    vars: [],
    counterClamp: 10,
    ...partial,
  }
}

describe('solver — availability (F8.6)', () => {
  it('marks an item guaranteed when every path grants it', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B')],
        choices: [choice('c1', 'A', 'B', { effects: grant('HARPOON') })],
        vars: [{ slug: 'HARPOON', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.availability.B.HARPOON).toBe('guaranteed')
    expect(r.availability.A.HARPOON).toBe('impossible')
  })

  it('marks an item merely possible when only one of two routes grants it', () => {
    // A --take--> B (grants) --> D,  A --leave--> C --> D
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        choices: [
          choice('c1', 'A', 'B', { effects: grant('HARPOON') }),
          choice('c2', 'A', 'C', { digit: '2' }),
          choice('c3', 'B', 'D'),
          choice('c4', 'C', 'D'),
        ],
        vars: [{ slug: 'HARPOON', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.availability.D.HARPOON).toBe('possible')
    expect(r.availability.B.HARPOON).toBe('guaranteed')
    expect(r.availability.C.HARPOON).toBe('impossible')
  })

  it('applies node-level effects on arrival', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B', { effects: grant('LANTERN') })],
        choices: [choice('c1', 'A', 'B')],
        vars: [{ slug: 'LANTERN', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.availability.B.LANTERN).toBe('guaranteed')
  })

  it('grants a starting item from the root node itself', () => {
    const r = solve(
      input({
        nodes: [node('A', { effects: grant('MAP') })],
        vars: [{ slug: 'MAP', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.availability.A.MAP).toBe('guaranteed')
  })
})

describe('solver — gates', () => {
  it('blocks a path whose gate cannot be satisfied', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('VAULT')],
        choices: [choice('c1', 'A', 'VAULT', { gate: gateOf(has('KEY')) })],
        vars: [{ slug: 'KEY', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.stateCount.VAULT).toBe(0)
    expect(r.findings.some((f) => f.kind === 'dead-gate')).toBe(true)
  })

  it('opens a gate once the item is obtainable', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('VAULT')],
        choices: [
          choice('c1', 'A', 'B', { effects: grant('KEY') }),
          choice('c2', 'B', 'VAULT', { gate: gateOf(has('KEY')) }),
        ],
        vars: [{ slug: 'KEY', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.stateCount.VAULT).toBe(1)
    expect(r.findings.some((f) => f.kind === 'dead-gate')).toBe(false)
  })

  it('a divert gate still moves a failing caller, without firing the choice effects', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('VAULT'), node('PIT')],
        choices: [
          choice('c1', 'A', 'VAULT', {
            effects: grant('TREASURE'),
            gate: { ...gateOf(has('KEY')), failBehavior: 'divert', failNodeId: 'PIT' },
          }),
        ],
        vars: [
          { slug: 'KEY', kind: 'item', isConsumable: false },
          { slug: 'TREASURE', kind: 'item', isConsumable: false },
        ],
      }),
    )
    expect(r.stateCount.PIT).toBe(1)
    expect(r.availability.PIT.TREASURE).toBe('impossible')
  })

  it('a refused gate leaves the caller in place', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('VAULT')],
        choices: [
          choice('c1', 'A', 'VAULT', {
            gate: { ...gateOf(has('KEY')), failBehavior: 'refuse' },
          }),
        ],
        vars: [{ slug: 'KEY', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.stateCount.VAULT).toBe(0)
  })

  it('treats a gate with no conditions as open', () => {
    // The gate builder starts every gate as an empty `and`; that must not lock
    // the door before any condition is added.
    const r = solve(
      input({
        nodes: [node('A'), node('B')],
        choices: [choice('c1', 'A', 'B', { gate: gateOf({ op: 'and', args: [] }) })],
      }),
    )
    expect(r.stateCount.B).toBe(1)
  })

  it('evaluates and / or / not together', () => {
    const expr: GateExpression = {
      op: 'and',
      args: [has('HARPOON'), { op: 'not', args: [has('WOUNDED')] }],
    }
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('WIN')],
        choices: [
          choice('c1', 'A', 'B', { effects: grant('HARPOON') }),
          choice('c2', 'B', 'WIN', { gate: gateOf(expr) }),
        ],
        vars: [
          { slug: 'HARPOON', kind: 'item', isConsumable: false },
          { slug: 'WOUNDED', kind: 'flag', isConsumable: false },
        ],
      }),
    )
    expect(r.stateCount.WIN).toBe(1)
  })
})

describe('solver — counters', () => {
  it('accumulates and gates on a counter', () => {
    const add = (n: number) => [{ varSlug: 'ROPE', operation: 'add' as const, amount: n }]
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('C'), node('DEEP')],
        choices: [
          choice('c1', 'A', 'B', { effects: add(2) }),
          choice('c2', 'B', 'C', { effects: add(2) }),
          choice('c3', 'C', 'DEEP', { gate: gateOf({ op: 'gte', var: 'ROPE', value: 3 }) }),
        ],
        vars: [{ slug: 'ROPE', kind: 'counter', isConsumable: false }],
      }),
    )
    expect(r.stateCount.DEEP).toBe(1)
  })

  it('terminates on a loop that adds to a counter forever', () => {
    // Without the clamp this is an infinite state space and the solver hangs.
    // That is exactly what §7 and §11.5 warn about.
    const r = solve(
      input({
        nodes: [node('A'), node('LOOP')],
        choices: [
          choice('c1', 'A', 'LOOP'),
          choice('c2', 'LOOP', 'LOOP', {
            effects: [{ varSlug: 'ROPE', operation: 'add', amount: 1 }],
          }),
        ],
        vars: [{ slug: 'ROPE', kind: 'counter', isConsumable: false }],
        counterClamp: 5,
      }),
    )
    // Saturates at the clamp: values 0..5 inclusive.
    expect(r.stateCount.LOOP).toBe(6)
    expect(r.truncated).toBe(false)
  })
})

describe('solver — cycles and reachability', () => {
  it('halts on a cycle because the state set stops growing', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('C')],
        choices: [
          choice('c1', 'A', 'B'),
          choice('c2', 'B', 'C'),
          choice('c3', 'C', 'B'), // back-edge
        ],
      }),
    )
    expect(r.stateCount.C).toBe(1)
    expect(r.truncated).toBe(false)
  })

  it('reports a node no path reaches', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('ISLAND')],
        choices: [choice('c1', 'A', 'B')],
      }),
    )
    expect(r.findings.some((f) => f.kind === 'unreachable' && f.nodeId === 'ISLAND')).toBe(true)
  })
})

describe('solver — item consistency (F8.7, F8.8)', () => {
  it('flags an item required but never granted', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B')],
        choices: [choice('c1', 'A', 'B', { gate: gateOf(has('GHOST_KEY')) })],
        vars: [{ slug: 'GHOST_KEY', kind: 'item', isConsumable: false }],
      }),
    )
    expect(
      r.findings.some((f) => f.kind === 'unobtainable-item' && f.varSlug === 'GHOST_KEY'),
    ).toBe(true)
  })

  it('flags an item granted but never asked for', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B')],
        choices: [choice('c1', 'A', 'B', { effects: grant('PEBBLE') })],
        vars: [{ slug: 'PEBBLE', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.findings.some((f) => f.kind === 'orphan-item' && f.varSlug === 'PEBBLE')).toBe(true)
  })

  it('consumes a consumable when its gate opens (F8.9)', () => {
    const r = solve(
      input({
        nodes: [node('A'), node('B'), node('C')],
        choices: [
          choice('c1', 'A', 'B', { effects: grant('CHARGE') }),
          choice('c2', 'B', 'C', { gate: { ...gateOf(has('CHARGE')), consumeOnPass: true } }),
        ],
        vars: [{ slug: 'CHARGE', kind: 'item', isConsumable: true }],
      }),
    )
    // Spent on the way through, so it is gone on arrival.
    expect(r.availability.C.CHARGE).toBe('impossible')
    expect(r.availability.B.CHARGE).toBe('guaranteed')
  })

  it('finds the depth-12 bug the spec describes', () => {
    // A long corridor, with the only source of KEY on a side branch that
    // rejoins AFTER the gate that needs it. A human would not spot this.
    const nodes = [node('A')]
    const choices: SolverChoice[] = []
    for (let i = 1; i <= 12; i++) {
      nodes.push(node(`N${i}`))
      choices.push(choice(`c${i}`, i === 1 ? 'A' : `N${i - 1}`, `N${i}`))
    }
    // The gate sits at N12; KEY is only granted on a branch off N12 itself.
    nodes.push(node('VAULT'), node('SIDE'))
    choices.push(
      choice('gate', 'N12', 'VAULT', { gate: gateOf(has('KEY')) }),
      choice('side', 'N12', 'SIDE', { digit: '2', effects: grant('KEY') }),
    )
    const r = solve(
      input({
        nodes,
        choices,
        vars: [{ slug: 'KEY', kind: 'item', isConsumable: false }],
      }),
    )
    expect(r.findings.some((f) => f.kind === 'dead-gate' && f.choiceId === 'gate')).toBe(true)
    expect(r.stateCount.VAULT).toBe(0)
  })
})

function gateOf(expression: GateExpression): NonNullable<SolverChoice['gate']> {
  return { expression, failBehavior: 'refuse', failNodeId: null, consumeOnPass: false }
}
