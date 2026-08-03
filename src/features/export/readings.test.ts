import { describe, expect, it } from 'vitest'
import { compileStory } from './compile'
import { addReading, addVar, choiceOf, makeGraph } from '@/test/factory'
import type { Gate, StoryGraph } from '@/types/domain'

/**
 * What a room that reads two ways compiles to.
 *
 * The rule is an if/elsif chain, and Studio has no such thing — so it is
 * numbered in Liquid and split on once. The tests that matter are the ones
 * about ORDER (first match wins, and the room itself is the "otherwise") and
 * about what happens when a reading has no take, because an unrecorded reading
 * REPLACES the room's words rather than falling back to them.
 */

const cell = () => {
  const g = makeGraph(['CELL', 'CORRIDOR'], ['CELL>CORRIDOR'], { recorded: ['CELL', 'CORRIDOR'] })
  addVar(g, 'LAMP')
  addVar(g, 'CROWBAR')
  return g
}

const compile = (g: StoryGraph) => compileStory(g, 'https://a/')
const byName = (g: StoryGraph, name: string) => compile(g).widgets.find((w) => w.name === name)

describe('a room with alternate readings', () => {
  it('costs two widgets plus one per recorded reading, whatever the count', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, { audio_path: 'a2.wav' })
    const names = compile(g).widgets.map((w) => w.name)
    expect(names).toContain('CELL_read')
    expect(names).toContain('CELL_alt')
    expect(names).toContain('CELL_alt1')
    expect(names).toContain('CELL_alt2')
  })

  it('numbers the readings in order, first match winning', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, { audio_path: 'a2.wav' })
    const liquid = byName(g, 'CELL_read')!.variables![0].value
    expect(liquid).toContain('{% if inv contains "|LAMP|" %}1')
    expect(liquid).toContain('{% elsif inv contains "|CROWBAR|" %}2')
    expect(liquid).toContain('{% else %}0{% endif %}')
  })

  /** Zero is the room as written — the "otherwise" is the room itself. */
  it('falls through to the room’s own audio when nothing matches', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    const split = byName(g, 'CELL_alt')!
    expect(split.transitions.find((t) => t.event === 'noMatch')!.next).toBe('CELL_play')
  })

  it('sends each number at its own reading', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, { audio_path: 'a2.wav' })
    const matches = byName(g, 'CELL_alt')!.transitions.filter((t) => t.event === 'match')
    expect(matches.map((t) => [t.match!.value, t.next])).toEqual([
      ['1', 'CELL_alt1'],
      ['2', 'CELL_alt2'],
    ])
  })

  it('lands every reading back on the room’s choices', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    expect(byName(g, 'CELL_alt1')!.transitions[0].next).toBe('CELL_gather')
  })

  /** Walking in has to reach the split, or the caller gets the base reading. */
  it('is what a caller entering the room arrives at', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    expect(compile(g).entryWidget).toBe('CELL_read')
  })

  it('is what a door into the room points at', () => {
    const g = makeGraph(['HALL', 'CELL'], ['HALL>CELL'], { recorded: ['HALL', 'CELL'] })
    addVar(g, 'LAMP')
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    const keys = compile(g).widgets.find((w) => w.name === 'HALL_keys')!
    expect(keys.transitions.find((t) => t.event === 'match')!.next).toBe('CELL_read')
  })

  /**
   * A timeout must replay the SAME version. Routing at the base play widget
   * would have read the room's own words to somebody the variant was for.
   */
  it('replays through the split, not through one of the readings', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    const gather = byName(g, 'CELL_gather')!
    expect(gather.transitions.find((t) => t.event === 'timeout')!.next).toBe('CELL_read')
  })

  it('changes nothing at all for a room with no readings', () => {
    const plain = compile(cell()).widgets.map((w) => w.name)
    expect(plain).not.toContain('CELL_read')
    expect(plain).toContain('CELL_play')
  })
})

describe('a reading nobody has recorded', () => {
  /** It stays in the chain: dropping it would let the reading BELOW it answer
   *  for cases that were never its own. */
  it('keeps its place in the numbering', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, { audio_path: 'a2.wav' })
    const liquid = byName(g, 'CELL_read')!.variables![0].value
    expect(liquid).toContain('{% if inv contains "|LAMP|" %}1')
    expect(byName(g, 'CELL_alt2')).toBeDefined()
  })

  it('goes straight to the choices, silently', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    const match = byName(g, 'CELL_alt')!.transitions.find((t) => t.match?.value === '1')!
    expect(match.next).toBe('CELL_gather')
    expect(byName(g, 'CELL_alt1')).toBeUndefined()
  })

  it('is reported, and says it replaces the room rather than adding to it', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    expect(compile(g).warnings.join(' ')).toContain("not even the room's own words")
  })

  it('reports a reading that would bury the ones below it', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'and', args: [] }, { audio_path: 'a1.wav' })
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'a2.wav' })
    expect(compile(g).warnings.join(' ')).toContain('nothing below it ever will')
  })
})

// ------------------------------------------------------------ spending items

function addGate(g: StoryGraph, choiceId: string, gate: Partial<Gate>) {
  g.gates.set(`g-${choiceId}`, {
    id: `g-${choiceId}`,
    story_id: g.story.id,
    choice_id: choiceId,
    expression: { op: 'has', var: 'KEY' },
    fail_behavior: 'refuse',
    fail_narration: null,
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: true,
    created_at: '',
    updated_at: '',
    ...gate,
  } as Gate)
}

const doorStory = () => {
  const g = makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL', 'VAULT'] })
  addVar(g, 'CROWBAR', { is_consumable: true })
  addVar(g, 'KEY', { is_consumable: true })
  return g
}

/**
 * consume_on_pass was honoured by the playtest and by the solver and emitted by
 * NEITHER, so a consumable was used up in rehearsal and kept forever on the
 * phone. Every test said the story worked.
 */
describe('using up what opened a door', () => {
  it('reaches the exported flow at all', () => {
    const g = doorStory()
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), {})
    const spend = compile(g).widgets.find((w) => w.name === 'HALL_d1_spend')
    expect(spend).toBeDefined()
    expect(spend!.variables![0].key).toBe('inv')
  })

  it('sits inside the gate, so a refused caller pays nothing', () => {
    const g = doorStory()
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), {})
    const gate = compile(g).widgets.find((w) => w.name === 'HALL_d1_gate')!
    expect(gate.transitions.find((t) => t.event === 'match')!.next).toBe('HALL_d1_spend')
  })

  it('takes every item a door that required all of them named', () => {
    const g = doorStory()
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), {
      expression: {
        op: 'and',
        args: [
          { op: 'has', var: 'CROWBAR' },
          { op: 'has', var: 'KEY' },
        ],
      },
    })
    const value = compile(g).widgets.find((w) => w.name === 'HALL_d1_spend')!.variables![0].value
    expect(value).toContain('replace: "|CROWBAR|", "|"')
    expect(value).toContain('replace: "|KEY|", "|"')
  })

  /** The two-item case. Both replaces are emitted, but a `spent` flag stops at
   *  the first one the caller turns out to be holding. */
  it('takes only one when either would have opened it', () => {
    const g = doorStory()
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), {
      expression: {
        op: 'or',
        args: [
          { op: 'has', var: 'CROWBAR' },
          { op: 'has', var: 'KEY' },
        ],
      },
    })
    const value = compile(g).widgets.find((w) => w.name === 'HALL_d1_spend')!.variables![0].value
    expect(value).toContain('assign spent = false')
    expect(value).toContain('and spent == false')
    expect(value).toContain('assign spent = true')
  })

  it('emits nothing when the box is not ticked', () => {
    const g = doorStory()
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), { consume_on_pass: false })
    expect(compile(g).widgets.find((w) => w.name === 'HALL_d1_spend')).toBeUndefined()
  })

  /** Ticked, and nothing it names is marked used up: from the editor this looks
   *  like it works. */
  it('says so when there is nothing to spend', () => {
    const g = doorStory()
    g.stateVars.get('var-KEY')!.is_consumable = false
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), { expression: { op: 'has', var: 'KEY' } })
    expect(compile(g).warnings.join(' ')).toContain('nothing is spent')
  })
})

describe('every transition still lands somewhere', () => {
  it('with readings, gates and spending all at once', () => {
    const g = doorStory()
    addVar(g, 'LAMP')
    addReading(g, 'HALL', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    addReading(g, 'HALL', { op: 'has', var: 'CROWBAR' })
    addGate(g, choiceOf(g, 'HALL', 'VAULT'), {})
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    const bad = r.widgets.flatMap((w) =>
      w.transitions.filter((t) => t.next && !names.has(t.next)).map((t) => `${w.name} -> ${t.next}`),
    )
    expect(bad).toEqual([])
    expect(names.has(r.entryWidget!)).toBe(true)
  })

  it('when an ending reads two ways', () => {
    const g = makeGraph(['HALL', 'END'], ['HALL>END'], {
      endings: ['END'],
      recorded: ['HALL', 'END'],
    })
    addVar(g, 'LAMP')
    addReading(g, 'END', { op: 'has', var: 'LAMP' }, { audio_path: 'a1.wav' })
    const r = compile(g)
    const names = new Set(r.widgets.map((w) => w.name))
    expect(
      r.widgets.flatMap((w) => w.transitions.filter((t) => t.next && !names.has(t.next))),
    ).toEqual([])
    // An ending hangs up by reaching a transition with no target.
    expect(names.has('END_alt1')).toBe(true)
  })
})
