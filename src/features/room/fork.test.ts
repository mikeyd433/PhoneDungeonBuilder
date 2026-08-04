import { describe, expect, it } from 'vitest'
import { buildRoomView } from './roomModel'
import { compileStory } from '@/features/export/compile'
import { PlaytestEngine } from '@/features/playtest/engine'
import { deriveGraph } from '@/features/graph/derived'
import { solve } from '@/features/state/solver'
import { toSolverInput } from '@/features/state/toSolverInput'
import { addVar, choiceOf, idOf, makeGraph, wordsOf } from '@/test/factory'
import { describeExpression } from '@/features/state/describe'
import { buildVarIndex, emptyState, type CallerState } from '@/features/state/expression'
import type { Gate, StoryGraph } from '@/types/domain'

/**
 * One key, two rooms.
 *
 * A room reading two ways was the wrong tool for "press 1 goes somewhere else
 * if you have the helmet" — readings make ONE room wear two faces, so the doors
 * are the same rows and share their labels. A fork is two rooms, each with its
 * own name, script and exits, and a check in the doorway between them.
 *
 * Underneath it is a `divert` gate, which has been in the schema since 0001.
 * What is new is that it is reachable from the door, and that the reaction to
 * pressing the key plays on BOTH routes — a divert is a fork, not a refusal.
 */

/** Press 1: the offer if you have the helmet, the shrug if you don't. */
const forest = () => {
  const g = makeGraph(['FOREST', 'OFFER', 'SHRUG'], ['FOREST>OFFER'], {
    recorded: ['FOREST', 'OFFER', 'SHRUG'],
  })
  addVar(g, 'HELMET', { name: "Tony Hawk's helmet" })
  const door = choiceOf(g, 'FOREST', 'OFFER')
  g.choices.get(door)!.label = 'Offer Helmet'
  const gate: Gate = {
    id: 'g1',
    story_id: g.story.id,
    choice_id: door,
    expression: { op: 'has', var: 'HELMET' },
    fail_behavior: 'divert',
    fail_narration: null,
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: idOf(g, 'SHRUG'),
    consume_on_pass: false,
    created_at: '',
    updated_at: '',
  }
  g.gates.set(gate.id, gate)
  return { g, door }
}

const index = (g: StoryGraph) =>
  buildVarIndex(
    [...g.stateVars.values()].map((v) => ({ slug: v.slug, kind: v.kind })),
    g.story.counter_clamp,
  )
const holding = (g: StoryGraph, slug: string): CallerState => {
  const i = index(g)
  return { ...emptyState(i), mask: 1 << i.bit.get(slug)! }
}

describe('the caller', () => {
  it('goes the first way carrying the thing', () => {
    const { g } = forest()
    const engine = new PlaytestEngine(g)
    const armed = { ...engine.start(), caller: holding(g, 'HELMET') }
    expect(engine.press(armed, '1').next.nodeId).toBe(idOf(g, 'OFFER'))
  })

  it('goes the other way without it — and is not refused', () => {
    const { g } = forest()
    const engine = new PlaytestEngine(g)
    const { next } = engine.press(engine.start(), '1')
    expect(next.nodeId).toBe(idOf(g, 'SHRUG'))
  })

  /** The door is still offered: a fork is not a lock, so nothing is hidden and
   *  nothing says no. */
  it('is offered the door either way', () => {
    const { g } = forest()
    const engine = new PlaytestEngine(g)
    expect(engine.offered(engine.start()).map((o) => o.label)).toEqual(['Offer Helmet'])
  })

  /**
   * The reaction is to pressing the key, not to passing a test. It used to play
   * only on the passing route, so half the callers heard nothing between the
   * keypress and a room they did not expect.
   */
  it('hears the door’s reaction on both routes', () => {
    const { g, door } = forest()
    g.choices.get(door)!.reaction_narration = 'Mike holds it out.'
    g.choices.get(door)!.audio_path = 'react.wav'
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    expect(wordsOf(engine.press(start, '1'))).toContain('Mike holds it out.')
    const armed = { ...start, caller: holding(g, 'HELMET') }
    expect(wordsOf(engine.press(armed, '1'))).toContain('Mike holds it out.')
  })
})

describe('the exported flow', () => {
  const compile = (g: StoryGraph) => compileStory(g, 'https://a/')

  it('splits the key on the item and lands each route in its own room', () => {
    const { g } = forest()
    const split = compile(g).widgets.find((w) => w.name === 'FOREST_d1_gate')!
    expect(split.transitions.find((t) => t.event === 'match')!.next).toBe('OFFER_play')
    expect(split.transitions.find((t) => t.event === 'noMatch')!.next).toBe('SHRUG_play')
  })

  /** Wrapped OUTSIDE the split, so both branches run through it. */
  it('plays the reaction before the split, not inside one branch', () => {
    const { g, door } = forest()
    g.choices.get(door)!.reaction_narration = 'Mike holds it out.'
    g.choices.get(door)!.audio_path = 'react.wav'
    const r = compile(g)
    const keys = r.widgets.find((w) => w.name === 'FOREST_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('FOREST_d1_react')
    expect(r.widgets.find((w) => w.name === 'FOREST_d1_react')!.transitions[0].next).toBe(
      'FOREST_d1_gate',
    )
  })

  /** A refusal is different and must stay different: hearing the reaction to a
   *  thing you were not allowed to do is worse than hearing nothing. */
  it('keeps a refusal’s reaction inside the gate', () => {
    const { g, door } = forest()
    g.choices.get(door)!.reaction_narration = 'Mike holds it out.'
    g.choices.get(door)!.audio_path = 'react.wav'
    const gate = [...g.gates.values()][0]
    gate.fail_behavior = 'refuse'
    gate.fail_node_id = null
    gate.fail_audio_path = 'no.wav'
    const r = compile(g)
    const keys = r.widgets.find((w) => w.name === 'FOREST_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('FOREST_d1_gate')
    const split = r.widgets.find((w) => w.name === 'FOREST_d1_gate')!
    expect(split.transitions.find((t) => t.event === 'match')!.next).toBe('FOREST_d1_react')
  })

  it('leaves no transition pointing at nothing', () => {
    const { g, door } = forest()
    g.choices.get(door)!.reaction_narration = 'Mike holds it out.'
    g.choices.get(door)!.audio_path = 'react.wav'
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    expect(
      r.widgets.flatMap((w) => w.transitions.filter((t) => t.next && !names.has(t.next))),
    ).toEqual([])
  })
})

/**
 * A fork on more than one item.
 *
 * The commonest fork in an item story is exactly the one a single condition
 * row could not write — either of two things opens it — so the sheet uses the
 * same builder the gates use. Nothing downstream needed changing, which is the
 * point of the fork being a gate: this checks that is actually true.
 */
describe('a fork on several items', () => {
  const twoWays = (op: 'and' | 'or') => {
    const { g, door } = forest()
    addVar(g, 'BOARD', { name: 'a skateboard' })
    ;[...g.gates.values()][0].expression = {
      op,
      args: [
        { op: 'has', var: 'HELMET' },
        { op: 'has', var: 'BOARD' },
      ],
    }
    return { g, door }
  }

  const both = (g: StoryGraph): CallerState => {
    const i = index(g)
    return { ...emptyState(i), mask: (1 << i.bit.get('HELMET')!) | (1 << i.bit.get('BOARD')!) }
  }

  it('takes the first route on ANY of them', () => {
    const { g } = twoWays('or')
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    expect(engine.press({ ...start, caller: holding(g, 'HELMET') }, '1').next.nodeId).toBe(
      idOf(g, 'OFFER'),
    )
    expect(engine.press({ ...start, caller: holding(g, 'BOARD') }, '1').next.nodeId).toBe(
      idOf(g, 'OFFER'),
    )
    expect(engine.press(start, '1').next.nodeId).toBe(idOf(g, 'SHRUG'))
  })

  it('needs ALL of them for an "all"', () => {
    const { g } = twoWays('and')
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    expect(engine.press({ ...start, caller: holding(g, 'HELMET') }, '1').next.nodeId).toBe(
      idOf(g, 'SHRUG'),
    )
    expect(engine.press({ ...start, caller: both(g) }, '1').next.nodeId).toBe(idOf(g, 'OFFER'))
  })

  it('compiles both items into the one boolean the split reads', () => {
    const { g } = twoWays('or')
    const r = compileStory(g, 'https://a/')
    const vars = r.widgets.find((w) => w.name === 'FOREST_gates')!.variables!
    expect(vars[0].value).toContain('inv contains "|HELMET|" or inv contains "|BOARD|"')
    // Still ONE split on the digit, whatever the condition's shape.
    expect(r.widgets.filter((w) => w.name === 'FOREST_d1_gate')).toHaveLength(1)
  })

  it('says both items out loud', () => {
    const { g } = twoWays('or')
    const named = [...g.stateVars.values()].map((v) => ({ slug: v.slug, name: v.name }))
    expect(describeExpression(named, [...g.gates.values()][0].expression)).toBe(
      "carrying Tony Hawk's helmet or carrying a skateboard",
    )
  })
})

describe('the map and the ledger', () => {
  it('names the room the door forks to, so the wall does not read as one exit', () => {
    const { g } = forest()
    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'FOREST'))!
    expect(view.exits.find((e) => e.digit === '1')?.forksTo).toBe('SHRUG')
  })

  it('leaves an ordinary door with no fork on it', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    expect(buildRoomView(g, deriveGraph(g), idOf(g, 'A'))!.exits[0].forksTo).toBeNull()
  })

  /** Both rooms are reachable, which is the point — and neither is an orphan. */
  it('reaches both rooms', () => {
    const { g } = forest()
    g.effects.set('e1', {
      id: 'e1',
      story_id: g.story.id,
      node_id: idOf(g, 'FOREST'),
      choice_id: null,
      state_var_id: 'var-HELMET',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '',
    })
    const derived = deriveGraph(g)
    expect(derived.unreachable.has(idOf(g, 'SHRUG'))).toBe(false)
    const r = solve(toSolverInput(g))
    expect(r.stateCount[idOf(g, 'OFFER')]).toBeGreaterThan(0)
  })
})
