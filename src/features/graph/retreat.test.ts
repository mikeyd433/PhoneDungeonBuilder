import { beforeEach, describe, expect, it } from 'vitest'
import { useDelve } from './store'
import { deriveGraph } from './derived'
import { addFight, idOf, makeGraph } from '@/test/factory'

/**
 * Retreating with no trail — the case you land in by deep-linking a room or
 * teleporting to one from the automap.
 *
 * The store used to answer this from `derived.parents`, which only holds edges
 * that carry a choice. A room reached by winning a fight has no choice pointing
 * at it, so it had no way back at all: pressing Back did nothing, silently,
 * while the room view listed the fight as a retreat the whole time.
 */
function stand(graph: ReturnType<typeof makeGraph>, at: string) {
  useDelve.setState({
    graph,
    derived: deriveGraph(graph),
    currentNodeId: idOf(graph, at),
    // Empty: this is arrival without a walk, which is what breaks the fallback.
    trail: [],
  })
}

describe('retreat with no trail', () => {
  beforeEach(() => useDelve.setState({ graph: null, derived: null, currentNodeId: null, trail: [] }))

  it('walks back through an ordinary door', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    stand(graph, 'CELL')
    useDelve.getState().retreat()
    expect(useDelve.getState().currentNodeId).toBe(idOf(graph, 'HALL'))
  })

  it('walks back out of a room reached by winning a fight', () => {
    const graph = makeGraph(['HALL', 'PIT', 'SHORE', 'DEEP'], ['HALL>PIT'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'SHORE', lose: 'DEEP' })
    stand(graph, 'SHORE')
    useDelve.getState().retreat()
    expect(useDelve.getState().currentNodeId).toBe(idOf(graph, 'PIT'))
  })

  it('walks back out of a room reached by losing a fight', () => {
    const graph = makeGraph(['HALL', 'PIT', 'SHORE', 'DEEP'], ['HALL>PIT'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'SHORE', lose: 'DEEP' })
    stand(graph, 'DEEP')
    useDelve.getState().retreat()
    expect(useDelve.getState().currentNodeId).toBe(idOf(graph, 'PIT'))
  })

  it('stays put when genuinely nothing leads here', () => {
    const graph = makeGraph(['HALL', 'LIMBO'], ['HALL>'])
    stand(graph, 'LIMBO')
    useDelve.getState().retreat()
    expect(useDelve.getState().currentNodeId).toBe(idOf(graph, 'LIMBO'))
  })

  it('prefers the trail when there is one', () => {
    const graph = makeGraph(['HALL', 'CELL', 'VAULT'], ['HALL>CELL', 'VAULT>CELL'])
    useDelve.setState({
      graph,
      derived: deriveGraph(graph),
      currentNodeId: idOf(graph, 'CELL'),
      trail: [idOf(graph, 'VAULT'), idOf(graph, 'CELL')],
    })
    useDelve.getState().retreat()
    expect(useDelve.getState().currentNodeId).toBe(idOf(graph, 'VAULT'))
  })
})
