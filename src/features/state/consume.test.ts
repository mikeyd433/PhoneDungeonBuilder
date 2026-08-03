import { describe, expect, it } from 'vitest'
import { consumePlan, consumedBy } from './consume'
import { buildVarIndex, emptyState, type CallerState } from './expression'
import type { GateExpression } from '@/types/domain'

/**
 * "Use up the item that opened this", when more than one item could have.
 *
 * The old implementation revoked every consumable the expression mentioned. On
 * a door the crowbar OR the master key opens, a caller carrying both lost both
 * — and the key they never used was gone for the door it was actually for.
 */

const index = buildVarIndex(
  [
    { slug: 'CROWBAR', kind: 'item' },
    { slug: 'KEY', kind: 'item' },
    { slug: 'LAMP', kind: 'item' },
    { slug: 'ROPE', kind: 'counter' },
  ],
  10,
)

const consumable = (slug: string) => slug !== 'LAMP'

const holding = (...slugs: string[]): CallerState => {
  let mask = 0
  for (const slug of slugs) mask |= 1 << index.bit.get(slug)!
  return { ...emptyState(index), mask }
}

const either: GateExpression = {
  op: 'or',
  args: [
    { op: 'has', var: 'CROWBAR' },
    { op: 'has', var: 'KEY' },
  ],
}

const both: GateExpression = {
  op: 'and',
  args: [
    { op: 'has', var: 'CROWBAR' },
    { op: 'has', var: 'KEY' },
  ],
}

describe('what a passing gate spends', () => {
  it('spends the one item a single condition names', () => {
    expect(consumedBy({ op: 'has', var: 'CROWBAR' }, holding('CROWBAR'), index, consumable)).toEqual(
      ['CROWBAR'],
    )
  })

  it('spends every item an "all" required — they were all needed', () => {
    expect(consumedBy(both, holding('CROWBAR', 'KEY'), index, consumable).sort()).toEqual([
      'CROWBAR',
      'KEY',
    ])
  })

  /** The bug this exists for. */
  it('spends only what opened it when either would have done', () => {
    expect(consumedBy(either, holding('CROWBAR', 'KEY'), index, consumable)).toEqual(['CROWBAR'])
  })

  it('spends the one they are actually carrying', () => {
    expect(consumedBy(either, holding('KEY'), index, consumable)).toEqual(['KEY'])
  })

  it('spends nothing for an item that is not marked used up', () => {
    expect(consumedBy({ op: 'has', var: 'LAMP' }, holding('LAMP'), index, consumable)).toEqual([])
  })

  /** Not having something costs nothing. */
  it('spends nothing for a `lacks`', () => {
    expect(consumedBy({ op: 'lacks', var: 'CROWBAR' }, emptyState(index), index, consumable)).toEqual(
      [],
    )
  })

  /** "at least 3 rope" is a requirement to hold three, not to burn them, and
   *  there is no sensible amount to deduct. */
  it('never touches a counter', () => {
    expect(
      consumedBy({ op: 'gte', var: 'ROPE', value: 3 }, emptyState(index), index, consumable),
    ).toEqual([])
  })

  it('names an item once however many times it appears', () => {
    const twice: GateExpression = {
      op: 'and',
      args: [
        { op: 'has', var: 'CROWBAR' },
        { op: 'has', var: 'CROWBAR' },
      ],
    }
    expect(consumedBy(twice, holding('CROWBAR'), index, consumable)).toEqual(['CROWBAR'])
  })

  it('spends nothing when no branch of an "any" holds', () => {
    expect(consumedBy(either, emptyState(index), index, consumable)).toEqual([])
  })
})

describe('the plan the exporter emits', () => {
  it('spends all of them for an "all"', () => {
    const plan = consumePlan(both, consumable)
    expect(plan.mode).toBe('all')
    expect(plan.slugs.sort()).toEqual(['CROWBAR', 'KEY'])
  })

  /** Studio cannot be asked which branch held, so the flow has to carry the
   *  "stop at the first one you find" rule itself. */
  it('spends the first one held for an "any"', () => {
    const plan = consumePlan(either, consumable)
    expect(plan.mode).toBe('first')
    expect(plan.slugs).toEqual(['CROWBAR', 'KEY'])
  })

  it('leaves out anything not marked used up', () => {
    const plan = consumePlan(
      {
        op: 'or',
        args: [
          { op: 'has', var: 'LAMP' },
          { op: 'has', var: 'KEY' },
        ],
      },
      consumable,
    )
    expect(plan.slugs).toEqual(['KEY'])
  })

  it('has nothing to do for a gate that only checks a counter', () => {
    expect(consumePlan({ op: 'gte', var: 'ROPE', value: 2 }, consumable).slugs).toEqual([])
  })
})
