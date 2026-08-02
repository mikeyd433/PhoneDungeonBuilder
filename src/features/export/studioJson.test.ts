import { describe, expect, it } from 'vitest'
import { compileStory } from './compile'
import { studioFlowJson } from './outputs'
import { addFight, makeGraph, setOutcome } from '@/test/factory'

/**
 * The failure this guards is the quiet one: a flow whose transitions carry only
 * a friendly_name imports into Studio without complaint and then never matches
 * anything. Every call falls straight through to noMatch, and you find out by
 * ringing the number.
 */
interface State {
  name: string
  type: string
  properties: Record<string, unknown>
  transitions: Array<{
    event: string
    next?: string
    conditions?: Array<{ friendly_name: string; arguments: string[]; type: string; value: string }>
  }>
}

const parse = (graph: ReturnType<typeof makeGraph>): State[] => {
  const compiled = compileStory(graph, 'https://audio.example/')
  return JSON.parse(studioFlowJson(graph, compiled, new Map())).states as State[]
}
const byName = (states: State[], name: string) => states.find((s) => s.name === name)!

describe('the Studio flow definition', () => {
  it('gives every conditional transition something to evaluate', () => {
    const graph = makeGraph(['HALL', 'A', 'B'], ['HALL>A', 'HALL>B'])
    for (const state of parse(graph)) {
      for (const t of state.transitions) {
        if (!t.conditions) continue
        for (const c of t.conditions) {
          expect(c.type, `${state.name} ${c.friendly_name}`).toBeTruthy()
          expect(c.value, `${state.name} ${c.friendly_name}`).toBeTruthy()
          expect(c.arguments?.[0], `${state.name} ${c.friendly_name}`).toBeTruthy()
        }
      }
    }
  })

  it('compares a keypress against the digits its own gather collected', () => {
    const graph = makeGraph(['HALL', 'A', 'B'], ['HALL>A', 'HALL>B'])
    const states = parse(graph)
    // The gather hands off; the split decides. Studio allows no conditions on
    // a gather at all.
    const gather = byName(states, 'HALL_gather')
    expect(gather.transitions.map((t) => t.event).sort()).toEqual([
      'keypress',
      'speech',
      'timeout',
    ])
    expect(gather.transitions.every((t) => !t.conditions)).toBe(true)

    const keys = byName(states, 'HALL_keys')
    const one = keys.transitions.find((t) => t.conditions?.[0].value === '1')!
    expect(one.conditions![0]).toMatchObject({
      arguments: ['{{widgets.HALL_gather.Digits}}'],
      type: 'equal_to',
      value: '1',
    })
  })

  it('configures the keypad instead of describing it in a note', () => {
    const graph = makeGraph(['HALL', 'A'], ['HALL>A'])
    const gather = byName(parse(graph), 'HALL_gather')
    expect(gather.properties).toMatchObject({ number_of_digits: 1, stop_gather: true, timeout: 5 })
  })

  it('compares a split against the input the split declared', () => {
    const graph = makeGraph(['PIT', 'WIN', 'LOSE'], [])
    addFight(graph, 'PIT', {
      moves: ['SWIM beats bite'],
      rounds: ['bite'],
      win: 'WIN',
      lose: 'LOSE',
      patience: 3,
    })
    setOutcome(graph, 'PIT', 0, 0, 'WIN')
    const states = parse(graph)
    const patience = states.find((s) => s.name.endsWith('_patience'))!
    const cond = patience.transitions.find((t) => t.conditions)!.conditions![0]
    expect(cond.type).toBe('less_than')
    expect(cond.value).toBe('3')
    // The subject is the widget's own input, not a guess.
    expect(cond.arguments[0]).toBe(patience.properties.input)
  })

  it('starts the call at a widget that exists', () => {
    const graph = makeGraph(['HALL', 'A'], ['HALL>A'])
    const states = parse(graph)
    const trigger = states.find((s) => s.name === 'Trigger')!
    const start = trigger.transitions.find((t) => t.event === 'incomingCall')!.next
    expect(states.map((s) => s.name)).toContain(start)
  })

  it('never points a transition at a widget it did not emit', () => {
    const graph = makeGraph(['HALL', 'A', 'B'], ['HALL>A', 'HALL>B', 'A>B'])
    const states = parse(graph)
    const present = new Set(states.map((s) => s.name))
    for (const s of states) {
      for (const t of s.transitions) {
        if (t.next) expect(present, `${s.name} -> ${t.next}`).toContain(t.next)
      }
    }
  })

  it('plays a recording once rather than looping it forever', () => {
    const graph = makeGraph(['HALL', 'A'], ['HALL>A'], { recorded: ['HALL'] })
    const play = byName(parse(graph), 'HALL_play')
    expect(play.properties).toMatchObject({ loop: 1 })
    expect(String(play.properties.play)).toContain('https://audio.example/')
  })
})
