import { describe, expect, it } from 'vitest'
import { buildRoomView } from './roomModel'
import { shortCondition } from '@/features/state/describe'
import { deriveGraph } from '@/features/graph/derived'
import { addReading, addVar, choiceOf, hideDoor, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/**
 * One room, one wall.
 *
 * There used to be a plate in the corner that stood you in the room as one kind
 * of caller: the wall became that caller's wall, doors they were not offered
 * moved to a "not offered here" list, and the narration became that reading's.
 * It went, because the thing it was for — press 1 goes somewhere else if you
 * have the helmet — is a **fork on the door**, and the fork needs no per-state
 * view at all: it is two ordinary rooms with a check between them.
 *
 * What is left is the author's view and only the author's view. Every door the
 * room has is on the wall, and a door only some callers are offered is MARKED
 * rather than hidden — §0's first rule, and the thing the switcher was
 * genuinely worse at, because a door you could not see was a door you had to
 * remember existed.
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

const view = (g: StoryGraph) => buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!

describe('the wall', () => {
  it('shows every door the room has, whatever the readings say', () => {
    const { g } = cell()
    expect(view(g).exits.filter((e) => e.choiceId).map((e) => e.digit)).toEqual(['1', '2'])
  })

  /** Marked, not removed — the whole reason the switcher could go. */
  it('marks the door only some callers are offered', () => {
    const { g } = cell()
    const grate = view(g).exits.find((e) => e.digit === '2')!
    expect(grate.hiddenIn).toBe(1)
    expect(grate.neverShown).toBe(false)
  })

  it('flags a door no reading offers at all', () => {
    const { g, lit } = cell()
    hideDoor(g, choiceOf(g, 'CELL', 'GRATE'), lit.id)
    expect(view(g).exits.find((e) => e.digit === '2')?.neverShown).toBe(true)
  })

  /** The room's own script, always. A reading's words are edited in the
   *  editor's Readings tab, which is where they are written. */
  it('reads out the room’s own narration, not a reading’s', () => {
    const { g } = cell()
    expect(view(g).lines.map((l) => l.text)).not.toContain(
      'The lamp finds a grate in the far wall.',
    )
  })

  /** A key carrying a door in any state is spoken for: a new door belongs to no
   *  state and would collide with whatever is already there. */
  it('puts the blank arch on the first key no door uses', () => {
    const { g } = cell()
    expect(view(g).exits.find((e) => !e.choiceId)?.digit).toBe('3')
  })
})

describe('naming a condition short enough for a chip', () => {
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
