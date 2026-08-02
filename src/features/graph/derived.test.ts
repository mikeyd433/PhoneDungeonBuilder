import { describe, expect, it } from 'vitest'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import { darkRooms, deriveGraph, trapNodes, unwrittenBranches } from './derived'

describe('deriveGraph — depth', () => {
  it('measures BFS depth from the root', () => {
    const g = makeGraph(['A', 'B', 'C', 'D'], ['A>B', 'B>C', 'C>D'])
    const d = deriveGraph(g)
    expect(d.depth.get(idOf(g, 'A'))).toBe(0)
    expect(d.depth.get(idOf(g, 'D'))).toBe(3)
  })

  it('takes the shortest route when a node has two paths in', () => {
    // A>B>D is length 2; A>C1>C2>D is length 3. Depth must report the shorter.
    const g = makeGraph(['A', 'B', 'C1', 'C2', 'D'], ['A>B', 'A>C1', 'B>D', 'C1>C2', 'C2>D'])
    const d = deriveGraph(g)
    expect(d.depth.get(idOf(g, 'D'))).toBe(2)
  })
})

describe('deriveGraph — portals vs doors', () => {
  it('flags a true back-edge as a portal', () => {
    // C loops back up to A, which is still open on the stack when we reach C.
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'B>C', 'C>A'])
    const d = deriveGraph(g)
    expect(d.portals.has(choiceOf(g, 'C', 'A'))).toBe(true)
    expect(d.portals.size).toBe(1)
  })

  it('does NOT flag reconvergence as a portal', () => {
    // B and C both lead to D. The second edge into D reaches an already-finished
    // node, not an ancestor — that is a door, not a stairwell. Depth-comparison
    // would get this wrong; the DFS colour map is what makes it right.
    const g = makeGraph(['A', 'B', 'C', 'D'], ['A>B', 'A>C', 'B>D', 'C>D'])
    const d = deriveGraph(g)
    expect(d.portals.size).toBe(0)
  })

  it('flags a self-loop as a portal', () => {
    const g = makeGraph(['A', 'B'], ['A>B', 'B>B'])
    const d = deriveGraph(g)
    expect(d.portals.has(choiceOf(g, 'B', 'B'))).toBe(true)
  })
})

describe('deriveGraph — orphans and reachability', () => {
  it('finds a node with no inbound choices', () => {
    const g = makeGraph(['A', 'B', 'LOST'], ['A>B'])
    const d = deriveGraph(g)
    expect(d.orphans.has(idOf(g, 'LOST'))).toBe(true)
    expect(d.orphans.has(idOf(g, 'A'))).toBe(false) // the root is never an orphan
  })

  it('separates orphaned from merely unreachable', () => {
    // X>Y is its own little island: Y has an inbound choice so it is not an
    // orphan, but neither node can be reached from the root.
    const g = makeGraph(['A', 'B', 'X', 'Y'], ['A>B', 'X>Y'])
    const d = deriveGraph(g)
    expect(d.orphans.has(idOf(g, 'Y'))).toBe(false)
    expect(d.unreachable.has(idOf(g, 'Y'))).toBe(true)
    expect(d.unreachable.has(idOf(g, 'X'))).toBe(true)
    expect(d.unreachable.has(idOf(g, 'B'))).toBe(false)
  })
})

describe('unwrittenBranches', () => {
  it('collects bricked archways', () => {
    const g = makeGraph(['A', 'B'], ['A>B', 'A>', 'B>'])
    expect(unwrittenBranches(g)).toHaveLength(2)
  })
})

describe('darkRooms', () => {
  it('sorts unrecorded nodes shallowest first', () => {
    const g = makeGraph(['A', 'B', 'C'], ['A>B', 'B>C'], { recorded: ['B'] })
    const dark = darkRooms(g, deriveGraph(g)).map((n) => n.slug)
    expect(dark).toEqual(['A', 'C']) // B has audio, so it is lit
  })
})

describe('trapNodes', () => {
  it('flags a cycle that can never reach an ending', () => {
    // A>B>C>B forever, and nothing in that loop reaches FIN.
    const g = makeGraph(['A', 'B', 'C', 'FIN'], ['A>B', 'B>C', 'C>B'], { endings: ['FIN'] })
    const traps = trapNodes(g, deriveGraph(g))
    expect(traps.has(idOf(g, 'B'))).toBe(true)
    expect(traps.has(idOf(g, 'C'))).toBe(true)
  })

  it('does not flag a loop that still has a way out', () => {
    const g = makeGraph(['A', 'B', 'C', 'FIN'], ['A>B', 'B>C', 'C>B', 'C>FIN'], {
      endings: ['FIN'],
    })
    const traps = trapNodes(g, deriveGraph(g))
    expect(traps.size).toBe(0)
  })
})
