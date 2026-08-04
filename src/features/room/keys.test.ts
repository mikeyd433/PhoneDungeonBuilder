import { describe, expect, it } from 'vitest'
import { doorForKey, doorsByDigit, keyConflicts, slotsToHideNewDoor } from './keys'
import { buildRoomView } from './roomModel'
import { compileStory } from './../export/compile'
import { PlaytestEngine } from '@/features/playtest/engine'
import { deriveGraph } from '@/features/graph/derived'
import { addReading, addVar, hideDoor, idOf, makeGraph } from '@/test/factory'
import { buildVarIndex, emptyState, type CallerState } from '@/features/state/expression'
import type { Choice, StoryGraph } from '@/types/domain'

/**
 * One key, two doors, one per state.
 *
 * `unique (from_node_id, digit)` was right when a room had one wall. A room
 * with readings has a wall per state, and "press 2" is allowed to be a
 * different door in each — different words, different destination — as long as
 * no single caller is ever offered both.
 */

/** Press 2: the lid without the crowbar, the hatch with it. */
const cell = () => {
  const g = makeGraph(['CELL', 'LOCKER', 'CRAWLSPACE'], ['CELL>LOCKER'], {
    recorded: ['CELL', 'LOCKER', 'CRAWLSPACE'],
  })
  addVar(g, 'CROWBAR', { name: 'the crowbar' })
  const armed = addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, {
    narration: 'The crowbar is heavy in your hand.',
    audio_path: 'armed.wav',
  })

  const lid = [...g.choices.values()].find((c) => c.digit === '1')!
  lid.digit = '2'
  lid.label = 'try the lid'

  // A SECOND door on digit 2, for the armed reading only.
  const hatch: Choice = {
    id: 'c-hatch',
    story_id: g.story.id,
    from_node_id: idOf(g, 'CELL'),
    to_node_id: idOf(g, 'CRAWLSPACE'),
    digit: '2',
    label: 'force the hatch',
    reaction_narration: null,
    audio_path: null,
    audio_duration_ms: null,
    sort_order: 1,
    created_at: '',
    updated_at: '',
  }
  g.choices.set(hatch.id, hatch)
  hideDoor(g, hatch.id, null) // no crowbar: no hatch
  hideDoor(g, lid.id, armed.id) // with the crowbar: no lid
  return { g, armed, lid, hatch }
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

describe('grouping doors by key', () => {
  it('puts both doors on digit 2 together', () => {
    const { g } = cell()
    expect(doorsByDigit(g, idOf(g, 'CELL')).get('2')).toHaveLength(2)
  })

  it('says which door a key opens, per state', () => {
    const { g, armed, lid, hatch } = cell()
    const at = idOf(g, 'CELL')
    expect(doorForKey(g, at, '2', null)?.id).toBe(lid.id)
    expect(doorForKey(g, at, '2', armed.id)?.id).toBe(hatch.id)
  })

  it('says no door at all where every one on the key is hidden', () => {
    const { g, armed, hatch } = cell()
    hideDoor(g, hatch.id, armed.id)
    expect(doorForKey(g, idOf(g, 'CELL'), '2', armed.id)).toBeNull()
  })
})

describe('what counts as a clash', () => {
  /** The whole point of the feature is not a problem. */
  it('is not two doors on a key when no state offers both', () => {
    const { g } = cell()
    expect(keyConflicts(g, idOf(g, 'CELL'))).toEqual([])
  })

  it('is two doors offered to the SAME caller', () => {
    const { g, armed, lid } = cell()
    // Un-hide the lid with the crowbar: now both are on the armed wall.
    g.hiddenDoors.delete(`hd-${lid.id}-${armed.id}`)
    const clash = keyConflicts(g, idOf(g, 'CELL'))
    expect(clash).toHaveLength(1)
    expect(clash[0].digit).toBe('2')
    expect(clash[0].slot).toBe(armed.id)
  })
})

describe('making the second door', () => {
  it('needs no rules at all when the key was free', () => {
    const { g, armed } = cell()
    expect(slotsToHideNewDoor(g, idOf(g, 'CELL'), '5', armed.id)).toEqual([])
  })

  /** Made while standing in one state, it belongs to that state — the others
   *  already have their answer for that key. */
  it('is hidden everywhere but the state it was made in', () => {
    const { g, armed } = cell()
    expect(slotsToHideNewDoor(g, idOf(g, 'CELL'), '2', armed.id)).toEqual([null])
  })

  /** Made in the authoring view it belongs to no state, so it is left alone
   *  and reported rather than guessed at. */
  it('is left visible when made with no state in mind', () => {
    const { g } = cell()
    expect(slotsToHideNewDoor(g, idOf(g, 'CELL'), '2', 'all')).toEqual([])
  })
})

describe('the room view', () => {
  const view = (g: StoryGraph) => buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!

  /**
   * One wall, showing every door.
   *
   * The wall used to be rendered per state, so "press 2" drew as whichever door
   * that caller got. That switcher is gone: the room view is the AUTHOR's view
   * and there is one of it, with the conditional doors marked rather than
   * removed. Both doors on the shared key are therefore on the wall together.
   */
  it('shows both doors on the shared key, marked as sharing it', () => {
    const { g } = cell()
    const doors = view(g).exits.filter((e) => e.choiceId)
    expect(doors.map((e) => e.label)).toEqual(['try the lid', 'force the hatch'])
    expect(doors.every((e) => e.sharesKey)).toBe(true)
  })

  it('draws a clash as a clash', () => {
    const { g, armed, lid } = cell()
    g.hiddenDoors.delete(`hd-${lid.id}-${armed.id}`)
    expect(view(g).exits.some((e) => e.keyClash)).toBe(true)
  })

  /** A key carrying a door in any state is spoken for on the author's wall: a
   *  new door there belongs to no state and would collide with it. */
  it('puts the blank arch on the first key no door uses at all', () => {
    const g = makeGraph(['CELL', 'HALL', 'LOCKER'], ['CELL>HALL', 'CELL>LOCKER'])
    addVar(g, 'CROWBAR')
    const armed = addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' })
    const lid = [...g.choices.values()].find((c) => c.digit === '2')!
    hideDoor(g, lid.id, armed.id)
    expect(view(g).exits.find((e) => !e.choiceId)?.digit).toBe('3')
  })
})

describe('the playtest', () => {
  it('offers one door on the key, and it is the right one', () => {
    const { g, armed } = cell()
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    expect(engine.offered(start).map((o) => o.label)).toEqual(['try the lid'])
    const withBar = { ...start, caller: holding(g, 'CROWBAR') }
    expect(engine.offered(withBar).map((o) => o.label)).toEqual(['force the hatch'])
    void armed
  })

  it('walks the caller to the room that state’s door leads to', () => {
    const { g } = cell()
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    expect(engine.press(start, '2').next.nodeId).toBe(idOf(g, 'LOCKER'))
    const withBar = { ...start, caller: holding(g, 'CROWBAR') }
    expect(engine.press(withBar, '2').next.nodeId).toBe(idOf(g, 'CRAWLSPACE'))
  })
})

describe('the exported flow', () => {
  const compile = (g: StoryGraph) => compileStory(g, 'https://a/')

  /** Two `Digits equals 2` transitions off one split would have Studio take the
   *  first and never reach the second. One transition, then a split on the
   *  reading number, is the fix. */
  it('emits ONE transition for the shared key', () => {
    const { g } = cell()
    const keys = compile(g).widgets.find((w) => w.name === 'CELL_keys')!
    const twos = keys.transitions.filter((t) => t.match?.value === '2')
    expect(twos).toHaveLength(1)
    expect(twos[0].next).toBe('CELL_d2_pick')
  })

  it('picks the door by the reading the caller arrived in', () => {
    const { g } = cell()
    const pick = compile(g).widgets.find((w) => w.name === 'CELL_d2_pick')!
    expect(pick.splitOn).toBe('{{flow.variables.read_CELL}}')
    const arms = pick.transitions.filter((t) => t.event === 'match')
    expect(arms.map((t) => t.match!.value)).toEqual(['0', '1'])
    expect(arms[0].next).toBe('LOCKER_play')
    expect(arms[1].next).toBe('CRAWLSPACE_play')
  })

  /** Same digit, two doors, two sets of widgets — names that collide are
   *  error 81022's second stated cause. */
  it('never emits two widgets with the same name', () => {
    const { g, armed, lid } = cell()
    // Give both doors a gate, so both want a `CELL_d2_gate`.
    for (const id of [lid.id, 'c-hatch']) {
      g.gates.set(`gate-${id}`, {
        id: `gate-${id}`,
        story_id: g.story.id,
        choice_id: id,
        expression: { op: 'has', var: 'CROWBAR' },
        fail_behavior: 'refuse',
        fail_narration: 'no',
        fail_audio_path: 'r.wav',
        fail_audio_duration_ms: null,
        fail_node_id: null,
        consume_on_pass: false,
        created_at: '',
        updated_at: '',
      })
    }
    void armed
    const names = compile(g).widgets.map((w) => w.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('CELL_d2_gate')
    expect(names).toContain('CELL_d2b_gate')
  })

  it('leaves no transition pointing at nothing', () => {
    const { g } = cell()
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    expect(
      r.widgets.flatMap((w) => w.transitions.filter((t) => t.next && !names.has(t.next))),
    ).toEqual([])
  })

  it('says so when two doors on a key are offered at once', () => {
    const { g, armed, lid } = cell()
    g.hiddenDoors.delete(`hd-${lid.id}-${armed.id}`)
    expect(compile(g).warnings.join(' ')).toContain('Only the first is reachable')
  })

  it('leaves a room with one door per key exactly as it was', () => {
    const g = makeGraph(['A', 'B'], ['A>B'], { recorded: ['A', 'B'] })
    const keys = compileStory(g, 'https://a/').widgets.find((w) => w.name === 'A_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('B_play')
    expect(compileStory(g, 'https://a/').widgets.find((w) => w.name === 'A_d1_pick')).toBeUndefined()
  })
})
