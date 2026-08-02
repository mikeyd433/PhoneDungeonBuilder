import { describe, expect, it } from 'vitest'
import { idOf, makeGraph } from '@/test/factory'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView, nextFreeDigit } from './roomModel'

function view(graph: ReturnType<typeof makeGraph>, slug: string) {
  const derived = deriveGraph(graph)
  return buildRoomView(graph, derived, idOf(graph, slug))!
}

describe('buildRoomView — exits', () => {
  it('pads empty walls with bricked archways so there is always somewhere to dig', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(3)
    expect(v.exits[0].kind).toBe('door')
    expect(v.exits.slice(1).every((e) => e.kind === 'bricked')).toBe(true)
    // Padding must not reuse a digit that is already spoken for.
    expect(v.exits.map((e) => e.digit)).toEqual(['1', '2', '3'])
  })

  it('does not reuse an occupied digit when padding', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    // Move the real exit to digit 2; padding should fill 1 and 3.
    const choice = [...g.choices.values()][0]
    g.choices.set(choice.id, { ...choice, digit: '2' })
    const v = view(g, 'A')
    expect(v.exits.map((e) => e.digit).sort()).toEqual(['1', '2', '3'])
    expect(v.exits.find((e) => e.digit === '2')!.kind).toBe('door')
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

  it('spills digits 4+ into the stacked overflow list (F1.13)', () => {
    const g = makeGraph(['A', 'B', 'C', 'D', 'E'], ['A>B', 'A>C', 'A>D', 'A>E'])
    const v = view(g, 'A')
    expect(v.exits).toHaveLength(3)
    expect(v.overflowExits).toHaveLength(1)
    expect(v.overflowExits[0].digit).toBe('4')
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
