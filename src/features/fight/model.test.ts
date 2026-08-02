import { describe, expect, it } from 'vitest'
import { addFight, idOf, makeGraph, setOutcome } from '@/test/factory'
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

  it('calls out a round that leads nowhere at all', () => {
    // Nothing counters "Headbutt", and there is no losing room to fall through
    // to, so every digit is a dead stop.
    const g = makeGraph(['A', 'WIN'], [])
    addFight(g, 'A', { moves: ['PUNCH beats Kick'], rounds: ['Kick', 'Headbutt'], win: 'WIN' })
    const problems = buildFightView(g, idOf(g, 'A'))!.problems
    expect(problems.some((p) => p.includes('Round 2') && p.includes('nothing gets past'))).toBe(true)
  })

  it('accepts several moves countering the same announcement', () => {
    // "Any of these gets you through" is a fight, not a mistake.
    const g = makeGraph(['A', 'WIN', 'LOSE'], [])
    addFight(g, 'A', {
      moves: ['PUNCH beats Kick', 'JAB beats Kick'],
      rounds: ['Kick'],
      win: 'WIN',
      lose: 'LOSE',
    })
    const view = buildFightView(g, idOf(g, 'A'))!
    expect(view.problems).toEqual([])
    expect(view.table[0].cells.map((c) => c.where)).toEqual(['WIN', 'WIN'])
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

describe('a round that names where its moves go', () => {
  it('sends every move to the same room when that is what the round says', () => {
    const g = sharkGraph()
    for (const move of [0, 1, 2]) setOutcome(g, 'SHARKS', 0, move, 'SHORE')
    const view = buildFightView(g, idOf(g, 'SHARKS'))!
    expect(view.table[0].cells.map((c) => c.where)).toEqual(['SHORE', 'SHORE', 'SHORE'])
    // A round with no right answer is fine. It just isn't a puzzle.
    expect(view.problems).toEqual([])
  })

  it('overrides the counter rule for one move and leaves the rest alone', () => {
    const g = sharkGraph()
    setOutcome(g, 'SHARKS', 0, 1, 'SHORE') // KICK, which would otherwise lose
    const cells = buildFightView(g, idOf(g, 'SHARKS'))!.table[0].cells
    expect(cells.map((c) => c.where)).toEqual(['round 2', 'SHORE', 'DROWNED'])
    expect(cells.map((c) => c.via)).toEqual(['advance', 'named', 'lose'])
  })

  it('treats a named move with no destination as an unwritten branch', () => {
    const g = sharkGraph()
    setOutcome(g, 'SHARKS', 0, 1, null)
    const view = buildFightView(g, idOf(g, 'SHARKS'))!
    expect(view.table[0].cells[1].wired).toBe(false)
    expect(view.problems.join(' ')).toContain('pressing 2 (KICK) leads nowhere yet')
  })

  it('does not ask for an announcement when every move names its own way out', () => {
    const g = sharkGraph()
    const round = [...g.fightRounds.values()][0]
    g.fightRounds.set(round.id, { ...round, opponent_move: '' })
    for (const move of [0, 1, 2]) setOutcome(g, 'SHARKS', 0, move, 'SHORE')
    expect(buildFightView(g, idOf(g, 'SHARKS'))!.problems).toEqual([])
  })

  it('still asks for an announcement when the round leans on the counter rule', () => {
    const g = sharkGraph()
    const round = [...g.fightRounds.values()][0]
    g.fightRounds.set(round.id, { ...round, opponent_move: '' })
    expect(buildFightView(g, idOf(g, 'SHARKS'))!.problems.join(' ')).toContain(
      "Round 1 doesn't say what the opponent does",
    )
  })

  it('makes a room reached only by a named move reachable', () => {
    const g = makeGraph(['ENTRANCE', 'SHARKS', 'SIDEWAYS', 'LOSE'], ['ENTRANCE>SHARKS'])
    addFight(g, 'SHARKS', { moves: ['PUNCH beats Kick'], rounds: ['Kick'], lose: 'LOSE' })
    setOutcome(g, 'SHARKS', 0, 0, 'SIDEWAYS')
    const d = deriveGraph(g)
    expect(d.orphans.has(idOf(g, 'SIDEWAYS'))).toBe(false)
    expect(d.depth.get(idOf(g, 'SIDEWAYS'))).toBe(2)
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
