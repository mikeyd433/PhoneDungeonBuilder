import { describe, expect, it } from 'vitest'
import { deriveGraph } from './derived'
import { buildRoomView } from '@/features/room/roomModel'
import { addFight, idOf, makeGraph, setOutcome } from '@/test/factory'

/**
 * Exits are ordered by the key the caller presses.
 *
 * The regression this guards: ordering ran off `sort_order`, which the importer
 * assigns once and never revisits. Re-assigning a door's digit renumbered the
 * lintel and left the door standing where it was, so a room read 2 · 1 · 3.
 */
const digitsOf = (graph: ReturnType<typeof makeGraph>, slug: string) => {
  const derived = deriveGraph(graph)
  const view = buildRoomView(graph, derived, idOf(graph, slug))!
  // Only the real doors: the wall also carries one blank arch to chisel
  // through, and its digit is whatever was still free.
  return view.exits.filter((e) => e.choiceId).map((e) => e.digit)
}

/** Re-key a choice the way the editor's digit picker does. */
function setDigit(graph: ReturnType<typeof makeGraph>, from: string, to: string, digit: string) {
  const fromId = idOf(graph, from)
  const toId = idOf(graph, to)
  for (const c of graph.choices.values()) {
    if (c.from_node_id === fromId && c.to_node_id === toId) {
      graph.choices.set(c.id, { ...c, digit: digit as never })
      return
    }
  }
  throw new Error(`no choice ${from} -> ${to}`)
}

describe('exit order', () => {
  it('follows the digit after it is reassigned', () => {
    const graph = makeGraph(['HUB', 'A', 'B', 'C'], ['HUB>A', 'HUB>B', 'HUB>C'])
    expect(digitsOf(graph, 'HUB')).toEqual(['1', '2', '3'])

    // Swap: the room that was 1 becomes 2 and vice versa.
    setDigit(graph, 'HUB', 'A', '9')
    setDigit(graph, 'HUB', 'B', '1')
    setDigit(graph, 'HUB', 'A', '2')
    expect(digitsOf(graph, 'HUB')).toEqual(['1', '2', '3'])

    const derived = deriveGraph(graph)
    const view = buildRoomView(graph, derived, idOf(graph, 'HUB'))!
    // Door 1 is now B, and it stands in the leftmost slot.
    expect(view.exits[0].targetId).toBe(idOf(graph, 'B'))
    expect(view.exits[0].slot).toBe(0)
    expect(view.exits[1].targetId).toBe(idOf(graph, 'A'))
  })

  it('orders * 0 # after the numerals, as the keypad does', () => {
    const graph = makeGraph(['HUB', 'A', 'B', 'C'], ['HUB>A', 'HUB>B', 'HUB>C'])
    setDigit(graph, 'HUB', 'A', '#')
    setDigit(graph, 'HUB', 'B', '0')
    setDigit(graph, 'HUB', 'C', '*')
    expect(digitsOf(graph, 'HUB')).toEqual(['*', '0', '#'])
  })

  it('keeps fight outcomes behind every real key', () => {
    const graph = makeGraph(['HUB', 'PIT', 'WIN', 'LOSE', 'LEDGE'], ['HUB>PIT'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'WIN', lose: 'LOSE' })
    // A round that names where a move goes adds a third kind of digit-less edge.
    setOutcome(graph, 'PIT', 0, 0, 'LEDGE')
    const derived = deriveGraph(graph)
    const kinds = (derived.edgesFrom.get(idOf(graph, 'PIT')) ?? []).map((e) => e.kind)
    // Win before lose before the round's named outcomes — sort_order still
    // decides among edges that carry no digit at all.
    expect(kinds).toEqual(['fight-win', 'fight-lose', 'fight-move'])
  })

  it('puts a choice ahead of a fight edge leaving the same room', () => {
    const graph = makeGraph(['PIT', 'SIDE', 'WIN', 'LOSE'], ['PIT>SIDE'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'WIN', lose: 'LOSE' })
    const derived = deriveGraph(graph)
    const kinds = (derived.edgesFrom.get(idOf(graph, 'PIT')) ?? []).map((e) => e.kind)
    expect(kinds[0]).toBe('choice')
  })
})
