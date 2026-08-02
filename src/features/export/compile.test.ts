import { describe, expect, it } from 'vitest'
import { idOf, makeGraph } from '@/test/factory'
import type { Gate, StateVar, StoryGraph } from '@/types/domain'
import { compileStory, WIDGET_LIMIT } from './compile'

const BASE = 'https://example.supabase.co/storage/v1/object/public/story-audio/'

function addItem(g: StoryGraph, slug: string): StateVar {
  const v: StateVar = {
    id: `v-${slug}`,
    story_id: g.story.id,
    slug,
    name: slug,
    kind: 'item',
    description: null,
    is_consumable: false,
    created_at: '',
    updated_at: '',
  }
  g.stateVars.set(v.id, v)
  return v
}

function addEffect(
  g: StoryGraph,
  owner: { node_id?: string; choice_id?: string },
  varId: string,
  operation: 'grant' | 'revoke' = 'grant',
) {
  const id = `e-${varId}-${owner.node_id ?? owner.choice_id}-${operation}`
  g.effects.set(id, {
    id,
    story_id: g.story.id,
    node_id: owner.node_id ?? null,
    choice_id: owner.choice_id ?? null,
    state_var_id: varId,
    operation,
    amount: null,
    sort_order: 0,
    created_at: '',
  })
}

function addGate(g: StoryGraph, choiceId: string, gate: Partial<Gate>) {
  const id = `g-${choiceId}`
  g.gates.set(id, {
    id,
    story_id: g.story.id,
    choice_id: choiceId,
    expression: { op: 'has', var: 'KEY' },
    fail_behavior: 'refuse',
    fail_narration: null,
    fail_node_id: null,
    consume_on_pass: false,
    created_at: '',
    updated_at: '',
    ...gate,
  } as Gate)
}

const choiceFrom = (g: StoryGraph, slug: string, digit: string) =>
  [...g.choices.values()].find((c) => c.from_node_id === idOf(g, slug) && c.digit === digit)!

const byName = (r: ReturnType<typeof compileStory>, n: string) =>
  r.widgets.find((w) => w.name === n)

describe('compile — widget shapes (§6.7)', () => {
  it('emits two widgets for a plain room', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const r = compileStory(g, BASE)
    expect(byName(r, 'A_play')?.type).toBe('say-play')
    expect(byName(r, 'A_gather')?.type).toBe('gather-input-on-call')
  })

  it('ends a story with play then hangup', () => {
    const g = makeGraph(['A', 'FIN'], ['A>FIN'], { endings: ['FIN'] })
    const r = compileStory(g, BASE)
    expect(byName(r, 'FIN_hangup')?.type).toBe('hangup')
    expect(byName(r, 'FIN_play')?.transitions[0].next).toBe('FIN_hangup')
    expect(byName(r, 'FIN_gather')).toBeUndefined()
  })

  it('plays the audio URL when a room is recorded and speaks it otherwise', () => {
    const g = makeGraph(['A', 'B'], ['A>B'], { recorded: ['A'] })
    const r = compileStory(g, BASE)
    expect(byName(r, 'A_play')?.playUrl).toBe(`${BASE}audio/A.mp3`)
    expect(byName(r, 'A_play')?.say).toBeUndefined()
    expect(byName(r, 'B_play')?.playUrl).toBeUndefined()
  })

  it('pays no widget for a choice with no effects (§6.2)', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const r = compileStory(g, BASE)
    // The gather transition wires straight to the target's play widget.
    const gather = byName(r, 'A_gather')!
    expect(gather.transitions.find((t) => t.condition?.includes('1'))?.next).toBe('B_play')
    expect(r.widgets.some((w) => w.name.includes('_fx'))).toBe(false)
  })

  it('puts choice effects between the gather and the target (§6.2)', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const v = addItem(g, 'HARPOON')
    addEffect(g, { choice_id: choiceFrom(g, 'A', '1').id }, v.id)
    const r = compileStory(g, BASE)
    const gather = byName(r, 'A_gather')!
    expect(gather.transitions.find((t) => t.condition?.includes('1'))?.next).toBe('A_d1_fx')
    expect(byName(r, 'A_d1_fx')?.transitions[0].next).toBe('B_play')
  })

  it('puts node effects before the play widget, so narration can use them', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const v = addItem(g, 'LANTERN')
    addEffect(g, { node_id: idOf(g, 'A') }, v.id)
    const r = compileStory(g, BASE)
    expect(byName(r, 'A_fx')?.transitions[0].next).toBe('A_play')
  })

  it('folds several inventory changes into one inv key rather than colliding', () => {
    // Two set-variables rows both named `inv` would silently drop one.
    const g = makeGraph(['A', 'B'], ['A>B'])
    const h = addItem(g, 'HARPOON')
    const l = addItem(g, 'LANTERN')
    addEffect(g, { choice_id: choiceFrom(g, 'A', '1').id }, h.id)
    addEffect(g, { choice_id: choiceFrom(g, 'A', '1').id }, l.id, 'revoke')
    const r = compileStory(g, BASE)
    const vars = byName(r, 'A_d1_fx')!.variables!
    expect(vars.filter((v) => v.key === 'inv')).toHaveLength(1)
    expect(vars[0].value).toContain('HARPOON')
    expect(vars[0].value).toContain('replace: "|LANTERN|"')
  })
})

describe('compile — gates (§6.3)', () => {
  it('batches every gate on a node into ONE set-variables widget', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'A>C'])
    addItem(g, 'KEY')
    addGate(g, choiceFrom(g, 'A', '1').id, {})
    addGate(g, choiceFrom(g, 'A', '2').id, {})
    const r = compileStory(g, BASE)
    const gateWidgets = r.widgets.filter((w) => w.name === 'A_gates')
    expect(gateWidgets).toHaveLength(1)
    // One batched eval + one split per gated choice, not two evals.
    expect(gateWidgets[0].variables).toHaveLength(2)
    expect(r.widgets.filter((w) => w.type === 'split-based-on')).toHaveLength(2)
  })

  it('evaluates gates BEFORE the play widget so a hide gate can be conditional', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    addItem(g, 'KEY')
    addGate(g, choiceFrom(g, 'A', '1').id, { fail_behavior: 'hide' })
    const r = compileStory(g, BASE)
    expect(byName(r, 'A_gates')?.transitions[0].next).toBe('A_play')
    // A hidden choice is never read aloud; its line is wrapped in a conditional.
    expect(byName(r, 'A_play')?.say).toContain('{% if flow.variables.gate_A_d1 == "pass" %}')
    // hide costs no split at all.
    expect(r.widgets.some((w) => w.type === 'split-based-on')).toBe(false)
  })

  it('returns a refusal to the GATHER, not the play widget', () => {
    // §6.3 — so the caller doesn't re-hear the whole scene.
    const g = makeGraph(['A', 'B'], ['A>B'])
    addItem(g, 'KEY')
    addGate(g, choiceFrom(g, 'A', '1').id, {
      fail_behavior: 'refuse',
      fail_narration: "The gate won't budge.",
    })
    const r = compileStory(g, BASE)
    const refuse = byName(r, 'A_d1_refuse')!
    expect(refuse.say).toBe("The gate won't budge.")
    expect(refuse.transitions[0].next).toBe('A_gather')
    expect(refuse.note).toContain('8th attempt')
  })

  it('sends a failed divert to its target', () => {
    const g = makeGraph(['A', 'VAULT', 'PIT'], ['A>VAULT', 'A>PIT'])
    addItem(g, 'KEY')
    addGate(g, choiceFrom(g, 'A', '1').id, {
      fail_behavior: 'divert',
      fail_node_id: idOf(g, 'PIT'),
    })
    const r = compileStory(g, BASE)
    const split = r.widgets.find((w) => w.type === 'split-based-on')!
    expect(split.transitions.find((t) => t.event === 'noMatch')?.next).toBe('PIT_play')
  })

  it('orders gate split before choice effects, so a blocked caller gains nothing', () => {
    const g = makeGraph(['A', 'VAULT'], ['A>VAULT'])
    const v = addItem(g, 'TREASURE')
    addItem(g, 'KEY')
    addEffect(g, { choice_id: choiceFrom(g, 'A', '1').id }, v.id)
    addGate(g, choiceFrom(g, 'A', '1').id, {})
    const r = compileStory(g, BASE)
    const gather = byName(r, 'A_gather')!
    // Gather -> split -> effects -> target.
    expect(gather.transitions.find((t) => t.condition?.includes('1'))?.next).toBe('A_d1_gate')
    const split = byName(r, 'A_d1_gate')!
    expect(split.transitions.find((t) => t.event === 'match')?.next).toBe('A_d1_fx')
  })
})

describe('compile — timeout, invalid and warnings', () => {
  it('repeats the room when no timeout or invalid target is set', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const gather = byName(compileStory(g, BASE), 'A_gather')!
    expect(gather.transitions.find((t) => t.event === 'timeout')?.next).toBe('A_play')
    expect(gather.transitions.find((t) => t.event === 'noMatch')?.next).toBe('A_play')
  })

  it('follows explicit timeout and invalid targets', () => {
    const g = makeGraph(['A', 'B', 'LOBBY'], ['A>B'])
    const a = g.nodes.get(idOf(g, 'A'))!
    g.nodes.set(a.id, { ...a, timeout_target_id: idOf(g, 'LOBBY'), invalid_target_id: idOf(g, 'LOBBY') })
    const gather = byName(compileStory(g, BASE), 'A_gather')!
    expect(gather.transitions.find((t) => t.event === 'timeout')?.next).toBe('LOBBY_play')
  })

  it('warns about an unwritten branch rather than emitting a dangling transition', () => {
    const g = makeGraph(['A'], ['A>'])
    const r = compileStory(g, BASE)
    expect(r.warnings.some((w) => w.includes('unwritten branch'))).toBe(true)
    const gather = byName(r, 'A_gather')!
    expect(gather.transitions.find((t) => t.condition?.includes('1'))?.next).toBe('A_gather')
  })

  it('warns about a dead-end room that is not an ending', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const r = compileStory(g, BASE)
    expect(r.warnings.some((w) => w.includes('B') && w.includes('no exits'))).toBe(true)
  })
})

describe('compile — budget (§6.5)', () => {
  it('counts two widgets per plain room', () => {
    const g = makeGraph(['A', 'B', 'FIN'], ['A>B', 'B>FIN'], { endings: ['FIN'] })
    expect(compileStory(g, BASE).budget.total).toBe(6)
  })

  it('lands a moderate story comfortably under the ceiling', () => {
    // §6.5: "a 200-node story with moderate item use lands somewhere near
    // 550–650 widgets — comfortable."
    const slugs = Array.from({ length: 200 }, (_, i) => `N${i}`)
    const edges = slugs.slice(0, -1).map((s, i) => `${s}>N${i + 1}`)
    const g = makeGraph(slugs, edges)
    const r = compileStory(g, BASE)
    expect(r.budget.total).toBeLessThan(WIDGET_LIMIT)
    expect(r.budget.warn).toBe(false)
  })

  it('warns at 80% of the widget ceiling', () => {
    const count = 900 // 2 widgets each = 1800 = 90% of 2000
    const slugs = Array.from({ length: count }, (_, i) => `N${i}`)
    const edges = slugs.slice(0, -1).map((s, i) => `${s}>N${i + 1}`)
    const r = compileStory(makeGraph(slugs, edges), BASE)
    expect(r.budget.total).toBeGreaterThan(WIDGET_LIMIT * 0.8)
    expect(r.budget.warn).toBe(true)
  })

  it('flags a route that could exhaust the 1,000-step execution cap', () => {
    const slugs = Array.from({ length: 300 }, (_, i) => `N${i}`)
    const edges = slugs.slice(0, -1).map((s, i) => `${s}>N${i + 1}`)
    const r = compileStory(makeGraph(slugs, edges), BASE)
    expect(r.stepCapRisk).toBe(true)
  })

  it('does not flag a short story for the step cap', () => {
    const g = makeGraph(['A', 'B', 'FIN'], ['A>B', 'B>FIN'], { endings: ['FIN'] })
    expect(compileStory(g, BASE).stepCapRisk).toBe(false)
  })
})
