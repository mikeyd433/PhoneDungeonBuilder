import { describe, expect, it } from 'vitest'
import { makeGraph, idOf } from '@/test/factory'
import type { Gate, StateVar, StoryGraph } from '@/types/domain'
import { PlaytestEngine } from './engine'

function withItem(graph: StoryGraph, slug: string, consumable = false): StateVar {
  const v: StateVar = {
    id: `v-${slug}`,
    story_id: graph.story.id,
    slug,
    name: slug,
    kind: 'item',
    description: null,
    is_consumable: consumable,
    audio_path: null,
    audio_duration_ms: null,
    created_at: '',
    updated_at: '',
  }
  graph.stateVars.set(v.id, v)
  return v
}

function grantOn(graph: StoryGraph, choiceId: string, varId: string) {
  const id = `e-${choiceId}-${varId}`
  graph.effects.set(id, {
    id,
    story_id: graph.story.id,
    node_id: null,
    choice_id: choiceId,
    state_var_id: varId,
    operation: 'grant',
    amount: null,
    sort_order: 0,
    created_at: '',
  })
}

function gateOn(graph: StoryGraph, choiceId: string, gate: Partial<Gate>) {
  const id = `g-${choiceId}`
  graph.gates.set(id, {
    id,
    story_id: graph.story.id,
    choice_id: choiceId,
    expression: { op: 'and', args: [] },
    fail_behavior: 'refuse',
    fail_narration: null,
    fail_node_id: null,
    consume_on_pass: false,
    created_at: '',
    updated_at: '',
    ...gate,
  } as Gate)
}

const choiceFrom = (g: StoryGraph, fromSlug: string, digit: string) =>
  [...g.choices.values()].find(
    (c) => c.from_node_id === idOf(g, fromSlug) && c.digit === digit,
  )!

describe('playtest engine', () => {
  it('walks from the entrance and logs the path', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const e = new PlaytestEngine(g)
    const { next } = e.press(e.start(), '1')
    expect(next.path).toEqual(['A', 'B'])
  })

  it('grants an item when the digit is pressed, not on arrival in the room', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const v = withItem(g, 'HARPOON')
    grantOn(g, choiceFrom(g, 'A', '1').id, v.id)
    const e = new PlaytestEngine(g)
    const start = e.start()
    expect(e.held(start)).toEqual([])
    expect(e.held(e.press(start, '1').next)).toEqual(['HARPOON'])
  })

  it('does not offer a hidden choice at all', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    withItem(g, 'KEY')
    gateOn(g, choiceFrom(g, 'A', '1').id, {
      expression: { op: 'has', var: 'KEY' },
      fail_behavior: 'hide',
    })
    const e = new PlaytestEngine(g)
    expect(e.offered(e.start())).toHaveLength(0)
  })

  it('offers a refused choice, speaks the reason, and stays put', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    withItem(g, 'KEY')
    gateOn(g, choiceFrom(g, 'A', '1').id, {
      expression: { op: 'has', var: 'KEY' },
      fail_behavior: 'refuse',
      fail_narration: "The gate won't budge.",
    })
    const e = new PlaytestEngine(g)
    const start = e.start()
    expect(e.offered(start)).toHaveLength(1)
    const { next, spoken } = e.press(start, '1')
    expect(spoken).toBe("The gate won't budge.")
    expect(next.nodeId).toBe(start.nodeId)
    expect(next.failedAttempts).toBe(1)
  })

  it('sends a failed divert somewhere else entirely', () => {
    const g = makeGraph(['A', 'VAULT', 'PIT'], ['A>VAULT', 'A>PIT'])
    withItem(g, 'KEY')
    gateOn(g, choiceFrom(g, 'A', '1').id, {
      expression: { op: 'has', var: 'KEY' },
      fail_behavior: 'divert',
      fail_node_id: idOf(g, 'PIT'),
    })
    const e = new PlaytestEngine(g)
    expect(e.press(e.start(), '1').next.nodeId).toBe(idOf(g, 'PIT'))
  })

  it('spends a consumable on the way through its gate', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'B>C'])
    const v = withItem(g, 'CHARGE', true)
    grantOn(g, choiceFrom(g, 'A', '1').id, v.id)
    gateOn(g, choiceFrom(g, 'B', '1').id, {
      expression: { op: 'has', var: 'CHARGE' },
      consume_on_pass: true,
    })
    const e = new PlaytestEngine(g)
    const atB = e.press(e.start(), '1').next
    expect(e.held(atB)).toEqual(['CHARGE'])
    expect(e.held(e.press(atB, '1').next)).toEqual([])
  })

  it('counts repeated refusals, so the patience valve has something to fire on', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    withItem(g, 'KEY')
    gateOn(g, choiceFrom(g, 'A', '1').id, { expression: { op: 'has', var: 'KEY' } })
    const e = new PlaytestEngine(g)
    let s = e.start()
    for (let i = 0; i < 3; i++) s = e.press(s, '1').next
    expect(s.failedAttempts).toBe(3)
  })

  it('repeats the room on timeout when no timeout target is set', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const e = new PlaytestEngine(g)
    const start = e.start()
    expect(e.timeout(start).next.nodeId).toBe(start.nodeId)
  })

  it('follows an explicit timeout target', () => {
    const g = makeGraph(['A', 'B', 'LOBBY'], ['A>B'])
    const a = g.nodes.get(idOf(g, 'A'))!
    g.nodes.set(a.id, { ...a, timeout_target_id: idOf(g, 'LOBBY') })
    const e = new PlaytestEngine(g)
    expect(e.timeout(e.start()).next.nodeId).toBe(idOf(g, 'LOBBY'))
  })

  it('marks an ending as finished', () => {
    const g = makeGraph(['A', 'FIN'], ['A>FIN'], { endings: ['FIN'] })
    const e = new PlaytestEngine(g)
    expect(e.press(e.start(), '1').next.finished).toBe(true)
  })

  it('says so rather than moving when a branch is unwritten', () => {
    const g = makeGraph(['A'], ['A>'])
    const e = new PlaytestEngine(g)
    const { next, spoken } = e.press(e.start(), '1')
    expect(next.nodeId).toBe(idOf(g, 'A'))
    expect(spoken).toContain('unwritten')
  })
})
