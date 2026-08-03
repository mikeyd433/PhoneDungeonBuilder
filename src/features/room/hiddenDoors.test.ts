import { describe, expect, it } from 'vitest'
import { alwaysHidden, doorShows, hidesDoor } from './variants'
import { buildRoomView } from './roomModel'
import { PlaytestEngine } from '@/features/playtest/engine'
import { compileStory } from '@/features/export/compile'
import { deriveGraph } from '@/features/graph/derived'
import { solve } from '@/features/state/solver'
import { toSolverInput } from '@/features/state/toSolverInput'
import { addReading, addVar, choiceOf, hideDoor, idOf, makeGraph } from '@/test/factory'
import { buildVarIndex, emptyState, type CallerState } from '@/features/state/expression'
import type { StoryGraph } from '@/types/domain'

/**
 * The check that picks the words picks the doors.
 *
 * Before this, the two halves of one decision lived apart: the words came from
 * a reading, the doors from a `hide` gate written separately on each door. It
 * also closes the hole `hide` always had — a hidden door works but nothing
 * announces it, whereas the reading that offers the door is the same one that
 * mentions it.
 */

/** A cell with a grate you can only see by lamplight. */
const cell = () => {
  const g = makeGraph(['CELL', 'CORRIDOR', 'GRATE'], ['CELL>CORRIDOR', 'CELL>GRATE'], {
    recorded: ['CELL', 'CORRIDOR', 'GRATE'],
  })
  addVar(g, 'LAMP', { name: 'the lamp' })
  const lit = addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, {
    narration: 'The lamp finds a grate in the far wall. Press 2 for the grate.',
    audio_path: 'lit.wav',
  })
  // The grate is not there for anybody without the lamp.
  hideDoor(g, choiceOf(g, 'CELL', 'GRATE'), null)
  return { g, lit }
}

const index = (g: StoryGraph) =>
  buildVarIndex(
    [...g.stateVars.values()].map((v) => ({ slug: v.slug, kind: v.kind })),
    g.story.counter_clamp,
  )

const holding = (g: StoryGraph, ...slugs: string[]): CallerState => {
  const i = index(g)
  let mask = 0
  for (const slug of slugs) mask |= 1 << i.bit.get(slug)!
  return { ...emptyState(i), mask }
}

describe('the rule', () => {
  /** No rows means every door under every reading, so adding this feature to a
   *  story changes nothing about any room nobody has touched. */
  it('offers every door when nobody has said otherwise', () => {
    const { g } = cell()
    expect(doorShows(g, choiceOf(g, 'CELL', 'CORRIDOR'), null)).toBe(true)
  })

  it('hides the one that was hidden, in the slot it was hidden in', () => {
    const { g, lit } = cell()
    const grate = choiceOf(g, 'CELL', 'GRATE')
    expect(doorShows(g, grate, null)).toBe(false)
    expect(doorShows(g, grate, lit.id)).toBe(true)
  })

  it('reports which slots hide a door', () => {
    const { g } = cell()
    expect(hidesDoor(g, choiceOf(g, 'CELL', 'GRATE'))).toEqual([null])
  })

  /** From the editor it looks like an ordinary door and on the phone it is a
   *  key that does nothing. */
  it('spots a door no reading offers at all', () => {
    const { g, lit } = cell()
    const grate = choiceOf(g, 'CELL', 'GRATE')
    expect(alwaysHidden(g, idOf(g, 'CELL'), grate)).toBe(false)
    hideDoor(g, grate, lit.id)
    expect(alwaysHidden(g, idOf(g, 'CELL'), grate)).toBe(true)
  })
})

describe('the playtest', () => {
  it('does not offer a door this caller cannot see', () => {
    const { g } = cell()
    const engine = new PlaytestEngine(g)
    const digits = engine.offered(engine.start()).map((o) => o.choice.digit)
    expect(digits).toEqual(['1'])
  })

  it('offers it once they are carrying the thing', () => {
    const { g } = cell()
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const armed = { ...start, caller: holding(g, 'LAMP') }
    expect(engine.offered(armed).map((o) => o.choice.digit)).toEqual(['1', '2'])
  })

  /** Pressing a digit that is not on offer is a wrong keypress, not a door. */
  it('treats the hidden digit as a miss', () => {
    const { g } = cell()
    const engine = new PlaytestEngine(g)
    const { next, spoken } = engine.press(engine.start(), '2')
    expect(next.nodeId).toBe(idOf(g, 'CELL'))
    expect(spoken).toContain("isn't one of the options")
  })
})

describe('the exported flow', () => {
  const compile = (g: StoryGraph) => compileStory(g, 'https://a/')

  it('splits the digit on the reading number', () => {
    const { g } = cell()
    const shown = compile(g).widgets.find((w) => w.name === 'CELL_d2_shown')
    expect(shown?.splitOn).toBe('{{flow.variables.read_CELL}}')
  })

  it('lets it through only under the readings that offer it', () => {
    const { g } = cell()
    const shown = compile(g).widgets.find((w) => w.name === 'CELL_d2_shown')!
    const matches = shown.transitions.filter((t) => t.event === 'match').map((t) => t.match!.value)
    // 0 is the room as written, and that is the slot the grate is hidden in.
    expect(matches).toEqual(['1'])
  })

  it('sends everyone else back to the choices', () => {
    const { g } = cell()
    const shown = compile(g).widgets.find((w) => w.name === 'CELL_d2_shown')!
    expect(shown.transitions.find((t) => t.event === 'noMatch')!.next).toBe('CELL_gather')
  })

  it('leaves an unrestricted door untouched', () => {
    const { g } = cell()
    expect(compile(g).widgets.find((w) => w.name === 'CELL_d1_shown')).toBeUndefined()
  })

  it('says so when a door is hidden everywhere', () => {
    const { g, lit } = cell()
    hideDoor(g, choiceOf(g, 'CELL', 'GRATE'), lit.id)
    expect(compile(g).warnings.join(' ')).toContain('no caller is ever offered it')
  })

  /** A rule with nothing to vary on does nothing, and looks like it works. */
  it('says so when the room has no readings to vary by', () => {
    const g = makeGraph(['CELL', 'CORRIDOR'], ['CELL>CORRIDOR'], { recorded: ['CELL', 'CORRIDOR'] })
    hideDoor(g, choiceOf(g, 'CELL', 'CORRIDOR'), null)
    expect(compileStory(g, 'https://a/').warnings.join(' ')).toContain('has no readings')
  })

  it('leaves no transition pointing at nothing', () => {
    const { g } = cell()
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    expect(
      r.widgets.flatMap((w) => w.transitions.filter((t) => t.next && !names.has(t.next))),
    ).toEqual([])
  })
})

describe('the room view', () => {
  it('marks a door only some callers are offered', () => {
    const { g } = cell()
    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!
    const grate = view.exits.find((e) => e.digit === '2')!
    expect(grate.hiddenIn).toBe(1)
    expect(grate.neverShown).toBe(false)
  })

  it('leaves an ordinary door looking ordinary', () => {
    const { g } = cell()
    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!
    expect(view.exits.find((e) => e.digit === '1')!.hiddenIn).toBe(0)
  })
})

describe('the solver', () => {
  /** It has to agree, or the ledger reports a route the phone never gives. */
  it('will not walk a door the caller’s reading does not offer', () => {
    const { g } = cell()
    const r = solve(toSolverInput(g))
    // Nothing grants the lamp anywhere, so the grate is unreachable.
    expect(r.stateCount[idOf(g, 'GRATE')]).toBe(0)
    expect(r.stateCount[idOf(g, 'CORRIDOR')]).toBeGreaterThan(0)
  })

  it('walks it once the item is obtainable', () => {
    const { g } = cell()
    g.effects.set('e1', {
      id: 'e1',
      story_id: g.story.id,
      node_id: idOf(g, 'CELL'),
      choice_id: null,
      state_var_id: 'var-LAMP',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '',
    })
    expect(solve(toSolverInput(g)).stateCount[idOf(g, 'GRATE')]).toBeGreaterThan(0)
  })
})
