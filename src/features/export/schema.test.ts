import { describe, expect, it } from 'vitest'
import { compileStory, type Widget } from './compile'
import { studioFlowJson } from './outputs'
import { addFight, addReading, addVar, hideDoor, makeGraph, setOutcome } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/**
 * Conformance with Twilio's flow-definition schema.
 *
 * This is the test that was missing, and its absence cost a real import: the
 * compiler hung per-digit conditions off a gather's `keypress` transitions and
 * added a `noMatch` to it. A gather accepts only keypress, speech and timeout,
 * and none of them carry conditions — so the whole flow failed validation and
 * the console said nothing more useful than "Something went wrong".
 *
 * Everything asserted here comes from
 * https://www.twilio.com/docs/studio/rest-api/v2/schemas
 */

/** Which transition events each widget type is allowed to declare. */
const ALLOWED_EVENTS: Record<string, string[]> = {
  trigger: ['incomingCall', 'incomingMessage', 'incomingRequest', 'incomingParent'],
  'say-play': ['audioComplete'],
  'gather-input-on-call': ['keypress', 'speech', 'timeout'],
  'split-based-on': ['match', 'noMatch'],
  'set-variables': ['next'],
}

/** Only a split's transitions may carry conditions. */
const CONDITIONS_ALLOWED = new Set(['split-based-on'])

const CONDITION_TYPES = new Set([
  'contains',
  'does_not_contain',
  'does_not_match_any_of',
  'does_not_start_with',
  'equal_to',
  'greater_than',
  'is_after_date',
  'is_after_time',
  'is_before_date',
  'is_before_time',
  'is_blank',
  'is_not_blank',
  'less_than',
  'matches_any_of',
  'not_equal_to',
  'regex',
  'starts_with',
])

function stories(): Array<[string, StoryGraph]> {
  const plain = makeGraph(['HALL', 'A', 'B'], ['HALL>A', 'HALL>B', 'A>B'], {
    endings: ['B'],
    recorded: ['HALL'],
  })

  const fight = makeGraph(['HALL', 'PIT', 'WIN', 'LOSE'], ['HALL>PIT'])
  addFight(fight, 'PIT', {
    moves: ['SWIM beats bite', 'PUNCH beats bite'],
    rounds: ['bite', 'thrash'],
    win: 'WIN',
    lose: 'LOSE',
    recorded: true,
  })
  setOutcome(fight, 'PIT', 0, 1, 'LOSE')

  const inventory = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
  inventory.story.inventory_key = '*'
  inventory.story.inventory_intro_audio_path = 'takes/carrying.mp3'
  inventory.story.inventory_empty_audio_path = 'takes/nothing.mp3'
  inventory.stateVars.set('v1', {
    id: 'v1',
    story_id: inventory.story.id,
    slug: 'ROPE',
    name: 'a coil of rope',
    kind: 'item',
    description: null,
    is_consumable: false,
    audio_path: 'takes/rope.mp3',
    audio_duration_ms: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  // A room that reads two ways, behind a door either of two items opens and
  // spends. Both of those emit widgets nothing else in this table produces.
  const readings = makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL', 'VAULT'] })
  addVar(readings, 'CROWBAR', { is_consumable: true })
  addVar(readings, 'KEY', { is_consumable: true })
  addReading(readings, 'HALL', { op: 'has', var: 'CROWBAR' }, { audio_path: 'takes/alt1.mp3' })
  addReading(readings, 'HALL', { op: 'has', var: 'KEY' })
  readings.gates.set('g1', {
    id: 'g1',
    story_id: readings.story.id,
    choice_id: [...readings.choices.values()][0].id,
    expression: {
      op: 'or',
      args: [
        { op: 'has', var: 'CROWBAR' },
        { op: 'has', var: 'KEY' },
      ],
    },
    fail_behavior: 'refuse',
    fail_narration: 'It will not budge.',
    fail_audio_path: 'takes/refuse.mp3',
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  // A door only one reading offers, plus an arrival check that routes the
  // caller onward — both emit splits on the reading number.
  const doors = makeGraph(['CELL', 'CORRIDOR', 'GRATE'], ['CELL>CORRIDOR', 'CELL>GRATE'], {
    recorded: ['CELL', 'CORRIDOR', 'GRATE'],
  })
  addVar(doors, 'LAMP')
  const lit = addReading(doors, 'CELL', { op: 'has', var: 'LAMP' }, {
    narration: 'The lamp finds a grate.',
    audio_path: 'takes/lit.mp3',
  })
  hideDoor(doors, [...doors.choices.values()].find((c) => c.digit === '2')!.id, null)
  addReading(doors, 'CORRIDOR', { op: 'lacks', var: 'LAMP' }, {
    goto_node_id: [...doors.nodes.values()].find((n) => n.slug === 'CELL')!.id,
  })
  void lit

  return [
    ['a plain story', plain],
    ['a fight', fight],
    ['an inventory readback', inventory],
    ['alternate readings and a two-item door', readings],
    ['reading-scoped doors and an arrival check', doors],
  ]
}

const compiled = (g: StoryGraph) => compileStory(g, 'https://audio.example/')

describe.each(stories())('%s', (_name, graph) => {
  const result = compiled(graph)
  const widgets: Widget[] = result.widgets

  it('only declares transition events its widget type allows', () => {
    for (const w of widgets) {
      const allowed = ALLOWED_EVENTS[w.type]
      expect(allowed, `unknown widget type ${w.type}`).toBeDefined()
      for (const t of w.transitions) {
        expect(allowed, `${w.name} (${w.type}) -> ${t.event}`).toContain(t.event)
      }
    }
  })

  it('puts conditions only where the schema permits them', () => {
    for (const w of widgets) {
      for (const t of w.transitions) {
        if (!t.match) continue
        expect(CONDITIONS_ALLOWED, `${w.name} is a ${w.type} carrying a condition`).toContain(w.type)
      }
    }
  })

  it('gives every split the input it is required to declare', () => {
    for (const w of widgets) {
      if (w.type !== 'split-based-on') continue
      expect(w.splitOn, `${w.name} has no input`).toBeTruthy()
    }
  })

  it('uses condition predicates Studio knows', () => {
    for (const w of widgets) {
      for (const t of w.transitions) {
        if (!t.match) continue
        expect(CONDITION_TYPES).toContain(t.match.type)
        expect(t.match.value.length, `${w.name} has an empty condition value`).toBeGreaterThan(0)
      }
    }
  })

  it('names every widget the way Studio requires', () => {
    for (const w of widgets) {
      expect(w.name, `${w.name} is not a legal widget name`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
    }
  })

  it('emits no duplicate widget names', () => {
    const seen = new Set<string>()
    for (const w of widgets) {
      expect(seen, `${w.name} twice`).not.toContain(w.name)
      seen.add(w.name)
    }
  })

  /**
   * The gather widget's schema is
   *   "oneOf": [{ "required": ["say"] }, { "required": ["play"] }]
   * and every gather this compiler emits is silent, because the room already
   * said its piece in the say-play widgets before it. With neither key the
   * WHOLE definition fails validation and Studio reports only "Something went
   * wrong" — the same trap the per-digit conditions fell into.
   */
  it('gives every gather the say-or-play its schema demands', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    for (const state of json.states) {
      if (state.type !== 'gather-input-on-call') continue
      const has = 'say' in state.properties || 'play' in state.properties
      expect(has, `${state.name} has neither say nor play`).toBe(true)
    }
  })

  /** A say-play with neither is the same failure, one widget along. */
  it('gives every say-play something to play', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    for (const state of json.states) {
      if (state.type !== 'say-play') continue
      const has = 'say' in state.properties || 'play' in state.properties
      expect(has, `${state.name} has neither say nor play`).toBe(true)
    }
  })

  it('gives every split the input its schema requires', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    for (const state of json.states) {
      if (state.type !== 'split-based-on') continue
      expect(state.properties.input, `${state.name}`).toBeTruthy()
    }
  })

  /** A set-variables transition's event is a `const` in the schema. */
  it('only ever transitions a set-variables on `next`', () => {
    for (const w of widgets) {
      if (w.type !== 'set-variables') continue
      expect(w.transitions.map((t) => t.event)).toEqual(['next'])
    }
  })

  it('shapes every variable the way the console does', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    for (const state of json.states) {
      for (const v of state.properties.variables ?? []) {
        expect(Object.keys(v).sort()).toEqual(['index', 'key', 'value'])
        expect(typeof v.index).toBe('string')
        expect(v.key.length).toBeGreaterThan(0)
      }
    }
  })

  /**
   * Every transition must land on a state that EXISTS — error 81022 names this
   * as one of the three ways a definition is rejected, alongside a schema
   * mismatch and duplicate widget names.
   */
  it('never points a transition at a state the JSON does not contain', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    const names = new Set(json.states.map((s: { name: string }) => s.name))
    for (const state of json.states) {
      for (const t of state.transitions ?? []) {
        if (t.next === undefined) continue
        expect(names, `${state.name} --${t.event}--> ${t.next}`).toContain(t.next)
      }
    }
  })

  it('starts at a state that exists', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    const names = new Set(json.states.map((s: { name: string }) => s.name))
    expect(json.initial_state).toBe('Trigger')
    expect(names).toContain(json.initial_state)
  })

  it('declares the flags the schema requires', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    expect(typeof json.flags.allow_concurrent_calls).toBe('boolean')
  })

  /**
   * Balanced Liquid. An unclosed `{% if %}` in a Set Variables value is not a
   * schema error — it imports and then misbehaves on a live call, which is the
   * worst kind.
   */
  it('closes every Liquid tag it opens', () => {
    for (const w of widgets) {
      for (const v of w.variables ?? []) {
        const opens = (v.value.match(/\{%\s*if\b/g) ?? []).length
        const closes = (v.value.match(/\{%\s*endif\b/g) ?? []).length
        expect(closes, `${w.name}.${v.key}: ${opens} if, ${closes} endif`).toBe(opens)
        expect((v.value.match(/\{%/g) ?? []).length).toBe((v.value.match(/%\}/g) ?? []).length)
        expect((v.value.match(/\{\{/g) ?? []).length).toBe((v.value.match(/\}\}/g) ?? []).length)
      }
    }
  })

  /**
   * §6.3's substring trap: Studio's `contains` matches inside words, so an
   * inventory test for ROPE would also match ROPEBURN. Every stored value and
   * every test must be pipe-wrapped.
   */
  it('pipe-wraps every inventory test', () => {
    for (const w of widgets) {
      for (const v of w.variables ?? []) {
        for (const m of v.value.matchAll(/inv contains "([^"]*)"/g)) {
          expect(m[1].startsWith('|') && m[1].endsWith('|'), `${w.name}: ${m[1]}`).toBe(true)
        }
      }
    }
  })

  it('stays inside Studio’s 1000-state ceiling', () => {
    expect(result.widgets.length + 1).toBeLessThanOrEqual(1000)
  })

  it('serialises conditions with all four required fields', () => {
    const json = JSON.parse(studioFlowJson(graph, result, new Map()))
    for (const state of json.states) {
      for (const t of state.transitions ?? []) {
        for (const c of t.conditions ?? []) {
          for (const field of ['friendly_name', 'type', 'arguments', 'value']) {
            expect(c[field], `${state.name}: condition missing ${field}`).toBeTruthy()
          }
        }
      }
    }
  })
})
