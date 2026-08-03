import { describe, expect, it } from 'vitest'
import { compileStory, type Widget } from './compile'
import { studioFlowJson } from './outputs'
import { addFight, addReading, addVar, makeGraph, setOutcome } from '@/test/factory'
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

  return [
    ['a plain story', plain],
    ['a fight', fight],
    ['an inventory readback', inventory],
    ['alternate readings and a two-item door', readings],
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
