import { describe, expect, it } from 'vitest'
import { PlaytestEngine } from './engine'
import { addReading, addVar, choiceOf, idOf, makeGraph } from '@/test/factory'
import { describeExpression } from '@/features/state/describe'
import { audioTargets } from '@/features/audio/targets'
import type { Gate, StoryGraph } from '@/types/domain'

/**
 * The rehearsal has to be of the story that ships.
 *
 * A playtest that reads the room's base narration to a caller the exporter
 * would have given an alternate to is worse than no playtest: it is a rehearsal
 * of a scene nobody will hear.
 */

const cell = () => {
  const g = makeGraph(['CELL', 'CORRIDOR'], ['CELL>CORRIDOR'])
  addVar(g, 'LAMP', { name: 'the lamp' })
  addVar(g, 'CROWBAR', { name: 'the crowbar' })
  g.nodes.get(idOf(g, 'CELL'))!.narration = 'It is too dark to see anything.'
  return g
}

/** Give the caller an item by walking them out and granting it on the door. */
function grantOnDoor(g: StoryGraph, from: string, to: string, varId: string) {
  const choiceId = choiceOf(g, from, to)
  g.effects.set(`e-${varId}`, {
    id: `e-${varId}`,
    story_id: g.story.id,
    node_id: null,
    choice_id: choiceId,
    state_var_id: varId,
    operation: 'grant',
    amount: null,
    sort_order: 0,
    created_at: '',
  })
}

describe('what the playtest reads out', () => {
  it('is the room’s own narration with nothing in hand', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'The lamp shows a door.' })
    const engine = new PlaytestEngine(g)
    const state = engine.start()
    expect(engine.playback(state).map((p) => p.say)).toEqual(['It is too dark to see anything.'])
    expect(engine.readingAt(state)).toBeNull()
  })

  it('is the alternate once the caller is carrying the thing', () => {
    const g = cell()
    // CORRIDOR loops back to CELL, so the caller can arrive holding the lamp.
    g.choices.set('c-back', {
      id: 'c-back',
      story_id: g.story.id,
      from_node_id: idOf(g, 'CORRIDOR'),
      to_node_id: idOf(g, 'CELL'),
      digit: '1',
      label: 'back',
      reaction_narration: null,
      audio_path: null,
      audio_duration_ms: null,
      sort_order: 0,
      created_at: '',
      updated_at: '',
    })
    grantOnDoor(g, 'CELL', 'CORRIDOR', 'var-LAMP')
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'The lamp shows a door.' })

    const engine = new PlaytestEngine(g)
    const out = engine.press(engine.start(), '1').next
    const back = engine.press(out, '1').next
    expect(back.nodeId).toBe(idOf(g, 'CELL'))
    expect(engine.playback(back).map((p) => p.say)).toEqual(['The lamp shows a door.'])
  })

  /** Arrival effects run before the reading is chosen, exactly as the exported
   *  flow runs `_fx` before `_read`. */
  it('sees an item granted on arrival in the very room that grants it', () => {
    const g = cell()
    g.effects.set('e-arrive', {
      id: 'e-arrive',
      story_id: g.story.id,
      node_id: idOf(g, 'CELL'),
      choice_id: null,
      state_var_id: 'var-LAMP',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '',
    })
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'You are holding it already.' })
    const engine = new PlaytestEngine(g)
    expect(engine.playback(engine.start()).map((p) => p.say)).toEqual([
      'You are holding it already.',
    ])
  })
})

describe('spending one of two possible items, in rehearsal', () => {
  const twoKeys = () => {
    const g = makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'])
    addVar(g, 'CROWBAR', { is_consumable: true })
    addVar(g, 'KEY', { is_consumable: true })
    const gate: Gate = {
      id: 'g1',
      story_id: g.story.id,
      choice_id: choiceOf(g, 'HALL', 'VAULT'),
      expression: {
        op: 'or',
        args: [
          { op: 'has', var: 'CROWBAR' },
          { op: 'has', var: 'KEY' },
        ],
      },
      fail_behavior: 'refuse',
      fail_narration: null,
      fail_audio_path: null,
      fail_audio_duration_ms: null,
      fail_node_id: null,
      consume_on_pass: true,
      created_at: '',
      updated_at: '',
    }
    g.gates.set(gate.id, gate)
    return g
  }

  it('keeps the item they did not use', () => {
    const g = twoKeys()
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    // Hand them both, the way an earlier room would have.
    const both =
      (1 << engine.index.bit.get('CROWBAR')!) | (1 << engine.index.bit.get('KEY')!)
    const armed = { ...start, caller: { ...start.caller, mask: both } }
    const after = engine.press(armed, '1').next
    expect(engine.held(after)).toEqual(['KEY'])
  })
})

describe('saying a condition out loud', () => {
  const vars = [
    { slug: 'CROWBAR', name: 'the crowbar' },
    { slug: 'KEY', name: 'the master key' },
  ]

  it('uses the name the author wrote, not the slug the export tests', () => {
    expect(describeExpression(vars, { op: 'has', var: 'CROWBAR' })).toBe('carrying the crowbar')
  })

  it('falls back to the slug for an item nobody named', () => {
    expect(describeExpression([], { op: 'has', var: 'ROPE' })).toBe('carrying ROPE')
  })

  /** The sentence that tells an author they built the wrong one. */
  it('says "or" for any-of, and "and" for all-of', () => {
    const args = [
      { op: 'has' as const, var: 'CROWBAR' },
      { op: 'has' as const, var: 'KEY' },
    ]
    expect(describeExpression(vars, { op: 'or', args })).toBe(
      'carrying the crowbar or carrying the master key',
    )
    expect(describeExpression(vars, { op: 'and', args })).toBe(
      'carrying the crowbar and carrying the master key',
    )
  })

  it('calls an empty requirement "always", which is the thing worth noticing', () => {
    expect(describeExpression(vars, { op: 'and', args: [] })).toBe('always')
  })

  it('calls an empty any-of "never"', () => {
    expect(describeExpression(vars, { op: 'or', args: [] })).toBe('never')
  })
})

describe('recording an alternate reading', () => {
  it('is its own slot, named by position', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    const target = audioTargets(g).find((t) => t.ref.kind === 'reading')!
    expect(target.file).toBe('CELL__alt1')
    expect(target.label).toContain('carrying the lamp')
  })

  it('numbers them so a second one cannot collide with the first', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' })
    expect(
      audioTargets(g)
        .filter((t) => t.ref.kind === 'reading')
        .map((t) => t.file),
    ).toEqual(['CELL__alt1', 'CELL__alt2'])
  })
})
