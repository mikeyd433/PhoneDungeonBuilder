import { describe, expect, it } from 'vitest'
import { buildRoomView } from './roomModel'
import { shortCondition } from '@/features/state/describe'
import { deriveGraph } from '@/features/graph/derived'
import { addReading, addVar, choiceOf, hideDoor, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/**
 * Standing in the room as one kind of caller.
 *
 * A room that reads two ways has two sets of doors, and looking at both at once
 * is how you author it but not how anybody experiences it. Picking a state
 * makes the wall that state's wall — which is also what makes the doors
 * editable one state at a time, rather than through a grid of checkboxes.
 */

/** A cell whose grate only exists by lamplight. */
const cell = () => {
  const g = makeGraph(['CELL', 'CORRIDOR', 'GRATE'], ['CELL>CORRIDOR', 'CELL>GRATE'])
  addVar(g, 'LAMP', { name: 'the lamp' })
  const lit = addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, {
    narration: 'The lamp finds a grate in the far wall.',
  })
  hideDoor(g, choiceOf(g, 'CELL', 'GRATE'), null)
  return { g, lit }
}

const view = (g: StoryGraph, at?: string | null | 'all') =>
  buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'), at)!

describe('the switcher', () => {
  /** Almost every room. The switcher only exists where there is something to
   *  switch between, and adding this feature must not put a control on 129
   *  rooms that have no readings. */
  it('is not there for a room that reads one way', () => {
    const g = makeGraph(['CELL', 'CORRIDOR'], ['CELL>CORRIDOR'])
    expect(buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!.states).toEqual([])
  })

  it('offers every state, the room as written, and all of them at once', () => {
    const { g } = cell()
    expect(view(g).states.map((s) => s.label)).toEqual([
      'Every state',
      'As written',
      'Has lamp',
    ])
  })

  /** The default has to be the authoring view, or opening a room you have been
   *  editing for weeks would suddenly be missing doors. */
  it('starts on every state at once', () => {
    const { g } = cell()
    expect(view(g).viewing).toBe('all')
    expect(view(g).exits.filter((e) => e.choiceId).map((e) => e.digit)).toEqual(['1', '2'])
  })
})

describe('standing in one state', () => {
  it('shows only the doors that state offers', () => {
    const { g, lit } = cell()
    expect(view(g, null).exits.filter((e) => e.choiceId).map((e) => e.digit)).toEqual(['1'])
    expect(view(g, lit.id).exits.filter((e) => e.choiceId).map((e) => e.digit)).toEqual(['1', '2'])
  })

  /** A door you have withheld is one you have to be able to give back, and a
   *  wall it is missing from gives you nowhere to do that. */
  it('lists the withheld ones separately, so they can be given back', () => {
    const { g } = cell()
    expect(view(g, null).withheldExits.map((e) => e.digit)).toEqual(['2'])
  })

  it('withholds nothing in the every-state view', () => {
    const { g } = cell()
    expect(view(g).withheldExits).toEqual([])
  })

  it('reads out the words this caller actually hears', () => {
    const { g, lit } = cell()
    expect(view(g, lit.id).readingText).toBe('The lamp finds a grate in the far wall.')
    expect(view(g, null).readingText).toBeNull()
  })

  /**
   * A hidden door still owns its digit. Offering it for a new door would build
   * two on the same key — which the digit picker forbids and this would slip
   * straight past.
   */
  it('never offers a blank arch on a digit a hidden door already uses', () => {
    const { g } = cell()
    const blank = view(g, null).exits.find((e) => !e.choiceId)
    expect(blank?.digit).not.toBe('2')
  })

  it('falls back to every state when the reading it was showing is deleted', () => {
    const { g } = cell()
    expect(view(g, 'a-reading-that-is-gone').viewing).toBe('all')
  })
})

describe('naming a state short enough for a tab', () => {
  const vars = [{ slug: 'LAMP', name: 'the lamp' }]

  it('says Has and No, the way an author says it — without the article', () => {
    expect(shortCondition(vars, { op: 'has', var: 'LAMP' })).toBe('Has lamp')
    expect(shortCondition(vars, { op: 'lacks', var: 'LAMP' })).toBe('No lamp')
  })

  it('falls back to the slug for an item nobody named', () => {
    expect(shortCondition([], { op: 'has', var: 'ROPE' })).toBe('Has ROPE')
  })

  it('joins two conditions, and summarises more', () => {
    const two = [
      { op: 'has' as const, var: 'LAMP' },
      { op: 'has' as const, var: 'ROPE' },
    ]
    expect(shortCondition(vars, { op: 'or', args: two })).toBe('Has lamp / Has ROPE')
    expect(shortCondition(vars, { op: 'and', args: two })).toBe('Has lamp + Has ROPE')
    expect(shortCondition(vars, { op: 'and', args: [...two, { op: 'has', var: 'KEY' }] })).toBe(
      '3 all',
    )
  })

  it('calls an empty condition what it is', () => {
    expect(shortCondition(vars, { op: 'and', args: [] })).toBe('Always')
    expect(shortCondition(vars, { op: 'or', args: [] })).toBe('Never')
  })
})
