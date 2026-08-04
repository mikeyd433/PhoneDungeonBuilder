import { describe, expect, it } from 'vitest'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView, nextFreeDigit } from './roomModel'

function view(graph: ReturnType<typeof makeGraph>, slug: string) {
  const derived = deriveGraph(graph)
  return buildRoomView(graph, derived, idOf(graph, slug))!
}

describe('buildRoomView — exits', () => {
  /**
   * ONE blank arch, not a wall padded out to three.
   *
   * Chiselling is still how rooms get made, so there has to be somewhere to
   * dig — but three of them meant a room with a single door could never look
   * like a room with a single door, which is the whole point of sizing the
   * arches to how many there are.
   */
  it('offers exactly one blank archway to chisel through', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(2)
    expect(v.exits[0].kind).toBe('door')
    expect(v.exits[1].kind).toBe('bricked')
    expect(v.exits.map((e) => e.digit)).toEqual(['1', '2'])
  })

  it('leaves a room with no doors one place to cut', () => {
    const g = makeGraph(['A'], [])
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(1)
    expect(v.exits[0].kind).toBe('bricked')
  })

  it('does not reuse an occupied digit when padding', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    // Move the real exit to digit 2; the blank arch should take 1.
    const choice = [...g.choices.values()][0]
    g.choices.set(choice.id, { ...choice, digit: '2' })
    const v = view(g, 'A')
    expect(v.exits.map((e) => e.digit).sort()).toEqual(['1', '2'])
    expect(v.exits.find((e) => e.digit === '2')!.kind).toBe('door')
  })

  it('stops offering one once the wall is full', () => {
    const g = makeGraph(['A', 'B', 'C', 'D', 'E', 'F'], ['A>B', 'A>C', 'A>D', 'A>E', 'A>F'])
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(5)
    expect(v.exits.every((e) => e.kind === 'door')).toBe(true)
  })

  it('renders a back-edge as a portal, not a door', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'B>C', 'C>A'])
    expect(view(g, 'C').exits[0].kind).toBe('portal')
  })

  it('renders an unwritten branch as bricked', () => {
    const g = makeGraph(['A'], ['A>'])
    expect(view(g, 'A').exits[0].kind).toBe('bricked')
  })

  it('gives an ending no exits at all', () => {
    const g = makeGraph(['A', 'FIN'], ['A>FIN'], { endings: ['FIN'] })
    const v = view(g, 'FIN')
    expect(v.isEnding).toBe(true)
    expect(v.exits).toHaveLength(0)
  })

  it('flags an ending that still has exits', () => {
    const g = makeGraph(['A', 'FIN', 'X'], ['A>FIN', 'FIN>X'], { endings: ['FIN'] })
    expect(view(g, 'FIN').endingWithExits).toBe(true)
  })

  it('spills the sixth door and beyond into the stacked list (F1.13)', () => {
    const g = makeGraph(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      ['A>B', 'A>C', 'A>D', 'A>E', 'A>F', 'A>G'],
    )
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(5)
    expect(v.overflowExits).toHaveLength(1)
    expect(v.overflowExits[0].digit).toBe('6')
  })
})

describe('buildRoomView — status and structure', () => {
  it('lights the torch only when audio exists', () => {
    const g = makeGraph(['A', 'B'], ['A>B'], { recorded: ['B'] })
    expect(view(g, 'A').torchLit).toBe(false)
    expect(view(g, 'B').torchLit).toBe(true)
  })

  it('reports depth for the notches', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'B>C'])
    expect(view(g, 'C').depth).toBe(2)
  })

  it('lists every parent so retreat can offer a chooser (F1.12)', () => {
    const g = makeGraph(['A', 'B', 'D'], ['A>D', 'B>D'])
    expect(view(g, 'D').retreats).toHaveLength(2)
  })

  it('lists siblings sharing a parent, for plaque cycling (F1.11)', () => {
    const g = makeGraph(['A', 'B', 'C', 'D'], ['A>B', 'A>C', 'A>D'])
    const v = view(g, 'B')
    expect(v.siblings).toHaveLength(3)
    expect(v.siblings).toContain(idOf(g, 'C'))
  })

  it('does not repeat a sibling reachable from two parents', () => {
    // D has two parents (A and B); A also leads to C. Cycling must not list D twice.
    const g = makeGraph(['A', 'B', 'C', 'D'], ['A>C', 'A>D', 'B>D'])
    const v = view(g, 'D')
    expect(new Set(v.siblings).size).toBe(v.siblings.length)
  })

  it('marks an orphan room', () => {
    const g = makeGraph(['A', 'LOST'], ['A>'])
    const v = view(g, 'LOST')
    expect(v.isOrphan).toBe(true)
    expect(v.isUnreachable).toBe(true)
  })
})

describe('nextFreeDigit', () => {
  it('skips digits already in use', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'A>C'])
    expect(nextFreeDigit(deriveGraph(g), idOf(g, 'A'))).toBe('3')
  })
})

describe('items on a door', () => {
  it('names them the way a person would, not the way the compiler does', () => {
    const graph = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    graph.stateVars.set('v1', {
      id: 'v1',
      story_id: graph.story.id,
      slug: 'ROPE',
      name: 'a coil of rope',
      kind: 'item',
      description: null,
      is_consumable: false,
      gain_narration: null,
      gain_audio_path: null,
      gain_audio_duration_ms: null,
      spend_narration: null,
      spend_audio_path: null,
      spend_audio_duration_ms: null,
      audio_path: null,
      audio_duration_ms: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    graph.effects.set('e1', {
      id: 'e1',
      story_id: graph.story.id,
      node_id: null,
      choice_id: choiceOf(graph, 'HALL', 'CAVE'),
      state_var_id: 'v1',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
    })
    const view = buildRoomView(graph, deriveGraph(graph), idOf(graph, 'HALL'))!
    expect(view.exits[0].grants).toEqual(['a coil of rope'])
  })

  it('falls back to the slug when nobody named it', () => {
    const graph = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    graph.stateVars.set('v1', {
      id: 'v1',
      story_id: graph.story.id,
      slug: 'ROPE',
      name: '   ',
      kind: 'item',
      description: null,
      is_consumable: false,
      gain_narration: null,
      gain_audio_path: null,
      gain_audio_duration_ms: null,
      spend_narration: null,
      spend_audio_path: null,
      spend_audio_duration_ms: null,
      audio_path: null,
      audio_duration_ms: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    graph.effects.set('e1', {
      id: 'e1',
      story_id: graph.story.id,
      node_id: null,
      choice_id: choiceOf(graph, 'HALL', 'CAVE'),
      state_var_id: 'v1',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
    })
    const view = buildRoomView(graph, deriveGraph(graph), idOf(graph, 'HALL'))!
    expect(view.exits[0].grants).toEqual(['ROPE'])
  })
})
