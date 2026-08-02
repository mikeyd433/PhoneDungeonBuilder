import { describe, expect, it } from 'vitest'
import { addFight, idOf, makeGraph } from '@/test/factory'
import { buildFightView, counterFor, digitForMove, fightFor } from './model'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView } from '@/features/room/roomModel'

/** The shark fight, in miniature: three moves, three rounds, win and lose set. */
function sharkGraph() {
  const g = makeGraph(['ENTRANCE', 'SHARKS', 'SHORE', 'DROWNED'], ['ENTRANCE>SHARKS'], {
    endings: ['DROWNED'],
  })
  addFight(g, 'SHARKS', {
    moves: ['PUNCH beats Kick', 'KICK beats Block', 'BLOCK beats Punch'],
    rounds: ['Kick', 'Block', 'Punch'],
    win: 'SHORE',
    lose: 'DROWNED',
  })
  return g
}

describe('fight model', () => {
  it('finds the move that counters a round', () => {
    const g = sharkGraph()
    const view = buildFightView(g, idOf(g, 'SHARKS'))!
    expect(counterFor(view.moves, view.rounds[0])?.slug).toBe('PUNCH')
    expect(counterFor(view.moves, view.rounds[2])?.slug).toBe('BLOCK')
  })

  it('matches move names the way a person would', () => {
    const g = sharkGraph()
    const view = buildFightView(g, idOf(g, 'SHARKS'))!
    const shouty = { ...view.rounds[0], opponent_move: '  KICK ' }
    expect(counterFor(view.moves, shouty)?.slug).toBe('PUNCH')
  })

  it('assigns digits by move order', () => {
    const g = sharkGraph()
    const view = buildFightView(g, idOf(g, 'SHARKS'))!
    expect(digitForMove(view.moves, view.moves[0].id)).toBe('1')
    expect(digitForMove(view.moves, view.moves[2].id)).toBe('3')
  })

  it('reports nothing wrong with a complete fight', () => {
    const g = sharkGraph()
    expect(buildFightView(g, idOf(g, 'SHARKS'))!.problems).toEqual([])
  })

  it('calls out a round nothing counters', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [])
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Kick', 'Headbutt'],
      win: 'WIN',
      lose: 'LOSE',
    })
    const problems = buildFightView(g, idOf(g, 'A'))!.problems
    expect(problems.some((p) => p.includes('Round 2') && p.includes('cannot be won'))).toBe(true)
  })

  it('calls out two moves claiming the same counter', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [])
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick', 'JAB beats Kick'],
      rounds: ['Kick'],
      win: 'WIN',
      lose: 'LOSE',
    })
    expect(buildFightView(g, idOf(g, 'A'))!.problems.join(' ')).toContain('both counter')
  })

  it('calls out an outcome with nowhere to go', () => {
    const g = makeGraph(['A', 'WIN'], [])
    addFight(g, 'A', { moves: ['PUNCH beats Kick'], rounds: ['Kick'], win: 'WIN' })
    expect(buildFightView(g, idOf(g, 'A'))!.problems.join(' ')).toContain('losing')
  })

  it('leaves a room with no fight alone', () => {
    const g = sharkGraph()
    expect(fightFor(g, idOf(g, 'ENTRANCE'))).toBeNull()
    expect(buildFightView(g, idOf(g, 'ENTRANCE'))).toBeNull()
  })
})

describe('fights in the graph', () => {
  it('makes the room after a won fight reachable, not an orphan', () => {
    // The bug this exists to prevent: SHORE has no inbound choice, only a
    // fight outcome, and a choices-only derivation calls it sealed.
    const g = sharkGraph()
    const d = deriveGraph(g)
    expect(d.orphans.has(idOf(g, 'SHORE'))).toBe(false)
    expect(d.unreachable.has(idOf(g, 'SHORE'))).toBe(false)
    expect(d.depth.get(idOf(g, 'SHORE'))).toBe(2)
  })

  it('still seals a room nothing at all leads to', () => {
    const g = sharkGraph()
    g.fights.clear()
    const d = deriveGraph(g)
    expect(d.orphans.has(idOf(g, 'SHORE'))).toBe(true)
  })

  it('gives a fight room no bricked archways to chisel', () => {
    const g = sharkGraph()
    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'SHARKS'))!
    expect(view.exits).toEqual([])
    expect(view.fight?.fight.opponent_name).toBe('The shark')
  })

  it('lets you walk back from the winning room to the fight', () => {
    const g = sharkGraph()
    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'SHORE'))!
    expect(view.retreats.map((r) => r.fromId)).toEqual([idOf(g, 'SHARKS')])
  })
})
