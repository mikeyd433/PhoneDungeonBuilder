import { describe, expect, it } from 'vitest'
import { MAX_ARRIVAL_HOPS, variantProblems, walkArrival } from './variants'
import { PlaytestEngine } from '@/features/playtest/engine'
import { compileStory } from '@/features/export/compile'
import { deriveGraph } from '@/features/graph/derived'
import { graphEdges } from '@/features/graph/edges'
import { solve } from '@/features/state/solver'
import { toSolverInput } from '@/features/state/toSolverInput'
import { addReading, addVar, choiceOf, idOf, makeGraph } from '@/test/factory'
import { buildVarIndex, emptyState, type CallerState } from '@/features/state/expression'
import type { StoryGraph } from '@/types/domain'

/**
 * The check that happens on the way IN.
 *
 * A gate lives on a door, so "arriving here with the rope is a different scene"
 * had to be written on every door into the room. This is the same question
 * asked once, in the room, and it can send the caller straight on — which is
 * how two outcomes get different dialogue and different exits: they are two
 * rooms and one check.
 */

/** LANDING checks the rope and forks: SAVED if you have it, LOST if not. */
const fork = () => {
  const g = makeGraph(
    ['HALL', 'LANDING', 'SAVED', 'LOST'],
    ['HALL>LANDING'],
    { recorded: ['HALL', 'LANDING', 'SAVED', 'LOST'] },
  )
  addVar(g, 'ROPE')
  addReading(g, 'LANDING', { op: 'has', var: 'ROPE' }, { goto: 'SAVED', narration: '' })
  return g
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

const noEffects = (_id: string, s: CallerState) => s

describe('walking in', () => {
  it('leaves the caller where they arrived when nothing matches', () => {
    const g = fork()
    const walk = walkArrival(g, idOf(g, 'LANDING'), emptyState(index(g)), index(g), noEffects)
    expect(walk.steps.map((s) => s.nodeId)).toEqual([idOf(g, 'LANDING')])
  })

  it('sends them on when the check holds', () => {
    const g = fork()
    const walk = walkArrival(g, idOf(g, 'LANDING'), holding(g, 'ROPE'), index(g), noEffects)
    expect(walk.steps.map((s) => s.nodeId)).toEqual([idOf(g, 'LANDING'), idOf(g, 'SAVED')])
  })

  /** Checks chain: a room you are routed into can check again. */
  it('follows a chain of checks in one arrival', () => {
    const g = fork()
    addReading(g, 'SAVED', { op: 'has', var: 'ROPE' }, { goto: 'LOST' })
    const walk = walkArrival(g, idOf(g, 'LANDING'), holding(g, 'ROPE'), index(g), noEffects)
    expect(walk.steps.map((s) => s.nodeId)).toEqual([
      idOf(g, 'LANDING'),
      idOf(g, 'SAVED'),
      idOf(g, 'LOST'),
    ])
    expect(walk.looped).toBe(false)
  })

  /** Two rooms each checking the same item and pointing at each other is a call
   *  that never lands. It stops, and says so. */
  it('stops on a cycle rather than spinning', () => {
    const g = fork()
    addReading(g, 'SAVED', { op: 'has', var: 'ROPE' }, { goto: 'LANDING' })
    const walk = walkArrival(g, idOf(g, 'LANDING'), holding(g, 'ROPE'), index(g), noEffects)
    expect(walk.looped).toBe(true)
    expect(walk.steps.length).toBeLessThanOrEqual(MAX_ARRIVAL_HOPS)
  })

  it('fires the arrival effects of every room it passes through', () => {
    const g = fork()
    const seen: string[] = []
    walkArrival(g, idOf(g, 'LANDING'), holding(g, 'ROPE'), index(g), (id, s) => {
      seen.push(g.nodes.get(id)!.slug)
      return s
    })
    expect(seen).toEqual(['LANDING', 'SAVED'])
  })

  it('reports a check that points at its own room', () => {
    const g = fork()
    addReading(g, 'LOST', { op: 'has', var: 'ROPE' }, { goto: 'LOST' })
    expect(variantProblems(g, idOf(g, 'LOST')).join(' ')).toContain('already in')
  })

  /** A check with no words is finished, not half-written. */
  it('does not nag about missing words on a check that only routes', () => {
    const g = fork()
    expect(variantProblems(g, idOf(g, 'LANDING'))).toEqual([])
  })
})

describe('the playtest', () => {
  it('walks the caller through, landing them past the check', () => {
    const g = fork()
    // Grant the rope on the door into LANDING.
    g.effects.set('e1', {
      id: 'e1',
      story_id: g.story.id,
      node_id: null,
      choice_id: choiceOf(g, 'HALL', 'LANDING'),
      state_var_id: 'var-ROPE',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '',
    })
    const engine = new PlaytestEngine(g)
    const after = engine.press(engine.start(), '1').next
    expect(after.nodeId).toBe(idOf(g, 'SAVED'))
  })

  it('leaves an empty-handed caller in the room that asked', () => {
    const g = fork()
    const engine = new PlaytestEngine(g)
    expect(engine.press(engine.start(), '1').next.nodeId).toBe(idOf(g, 'LANDING'))
  })

  /** "Which rooms did this call touch" has to include the one it was routed
   *  through, or the path log is a lie about where the caller went. */
  it('records every room passed through on the path', () => {
    const g = fork()
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const armed = { ...start, caller: holding(g, 'ROPE') }
    const after = engine.press(armed, '1').next
    expect(after.path).toEqual(['HALL', 'LANDING', 'SAVED'])
  })

  it('says so rather than hanging when the checks go in a circle', () => {
    const g = fork()
    addReading(g, 'SAVED', { op: 'has', var: 'ROPE' }, { goto: 'LANDING' })
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const armed = { ...start, caller: holding(g, 'ROPE') }
    expect(engine.press(armed, '1').spoken).toContain('round in a circle')
  })
})

describe('the exported flow', () => {
  const compile = (g: StoryGraph) => compileStory(g, 'https://a/')

  it('routes an unrecorded check straight into its destination', () => {
    const g = fork()
    const split = compile(g).widgets.find((w) => w.name === 'LANDING_alt')!
    expect(split.transitions.find((t) => t.match?.value === '1')!.next).toBe('SAVED_play')
  })

  it('plays a check that has words, then goes on', () => {
    const g = makeGraph(['HALL', 'LANDING', 'SAVED'], ['HALL>LANDING'], {
      recorded: ['HALL', 'LANDING', 'SAVED'],
    })
    addVar(g, 'ROPE')
    addReading(g, 'LANDING', { op: 'has', var: 'ROPE' }, {
      goto: 'SAVED',
      narration: 'The rope goes taut.',
      audio_path: 'a1.wav',
    })
    expect(compile(g).widgets.find((w) => w.name === 'LANDING_alt1')!.transitions[0].next).toBe(
      'SAVED_play',
    )
  })

  it('still offers the room’s own doors to everyone else', () => {
    const g = fork()
    const split = compile(g).widgets.find((w) => w.name === 'LANDING_alt')!
    expect(split.transitions.find((t) => t.event === 'noMatch')!.next).toBe('LANDING_play')
  })

  it('leaves no transition pointing at nothing', () => {
    const g = fork()
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    expect(r.widgets.flatMap((w) => w.transitions.filter((t) => t.next && !names.has(t.next)))).toEqual(
      [],
    )
  })
})

describe('the map and the ledger', () => {
  /** Left out of the edges, the room behind a check reports as sealed and never
   *  appears — the same failure that made the fight edges necessary. */
  it('counts a check as a way through the dungeon', () => {
    const g = fork()
    const edge = graphEdges(g).find((e) => e.kind === 'reading')
    expect(edge?.from_node_id).toBe(idOf(g, 'LANDING'))
    expect(edge?.to_node_id).toBe(idOf(g, 'SAVED'))
  })

  it('does not make it a door — there is no key to press', () => {
    const g = fork()
    const derived = deriveGraph(g)
    expect(derived.children.get(idOf(g, 'LANDING'))).toEqual([])
  })

  it('stops the room behind it reading as unreachable', () => {
    const g = fork()
    const derived = deriveGraph(g)
    expect(derived.unreachable.has(idOf(g, 'SAVED'))).toBe(false)
    expect(derived.orphans.has(idOf(g, 'SAVED'))).toBe(false)
  })
})

describe('the solver', () => {
  it('reaches the room behind a check, and only with the item', () => {
    const g = fork()
    g.effects.set('e1', {
      id: 'e1',
      story_id: g.story.id,
      node_id: null,
      choice_id: choiceOf(g, 'HALL', 'LANDING'),
      state_var_id: 'var-ROPE',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '',
    })
    const r = solve(toSolverInput(g))
    expect(r.stateCount[idOf(g, 'SAVED')]).toBeGreaterThan(0)
    // The caller is routed straight out, so LANDING is never somewhere they
    // stand and pick a door.
    expect(r.stateCount[idOf(g, 'LANDING')]).toBe(0)
  })

  it('leaves the caller standing there when the check cannot hold', () => {
    const g = fork()
    const r = solve(toSolverInput(g))
    expect(r.stateCount[idOf(g, 'LANDING')]).toBeGreaterThan(0)
  })
})
