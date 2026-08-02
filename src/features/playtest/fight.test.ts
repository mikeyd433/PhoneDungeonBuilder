import { describe, expect, it } from 'vitest'
import { addFight, idOf, makeGraph } from '@/test/factory'
import { PlaytestEngine } from './engine'

/** ENTRANCE → SHARKS (a three-round fight) → SHORE or DROWNED. */
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

/** Walk from the entrance into the fight. */
function atTheFight(engine: PlaytestEngine) {
  return engine.press(engine.start(), '1').next
}

describe('playtesting a fight', () => {
  it('starts on round one when the caller walks in', () => {
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    const state = atTheFight(engine)
    expect(state.nodeId).toBe(idOf(g, 'SHARKS'))
    expect(state.fightRound).toBe(0)
    expect(engine.roundPrompt(state)).toContain('Kick')
  })

  it('offers moves rather than doors', () => {
    const engine = new PlaytestEngine(sharkGraph())
    const state = atTheFight(engine)
    expect(engine.offered(state)).toEqual([])
    expect(engine.fightOptions(state).map((o) => o.slug)).toEqual(['PUNCH', 'KICK', 'BLOCK'])
  })

  it('advances a round on the right answer', () => {
    const engine = new PlaytestEngine(sharkGraph())
    // Round one announces Kick; PUNCH beats Kick, and PUNCH is digit 1.
    const { next } = engine.press(atTheFight(engine), '1')
    expect(next.fightRound).toBe(1)
    expect(engine.roundPrompt(next)).toContain('Block')
  })

  it('lands in the winning room after the last round', () => {
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    let state = atTheFight(engine)
    for (const digit of ['1', '2', '3']) state = engine.press(state, digit).next
    expect(state.nodeId).toBe(idOf(g, 'SHORE'))
    expect(state.fightRound).toBeNull()
  })

  it('loses on a wrong move, immediately', () => {
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    const { next } = engine.press(atTheFight(engine), '2')
    expect(next.nodeId).toBe(idOf(g, 'DROWNED'))
    expect(next.finished).toBe(true)
  })

  it('loses on a digit no move is mapped to', () => {
    // There is no "that isn't one of the options" in a fight — pressing 9 is
    // an answer, and it is the wrong one.
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    expect(engine.press(atTheFight(engine), '9').next.nodeId).toBe(idOf(g, 'DROWNED'))
  })

  it('loses on silence, the same as the exported flow does', () => {
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    expect(engine.timeout(atTheFight(engine)).next.nodeId).toBe(idOf(g, 'DROWNED'))
  })

  it('says so rather than pretending when an outcome has nowhere to go', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    addFight(g, 'B', { moves: ['PUNCH beats Kick'], rounds: ['Kick'] })
    const engine = new PlaytestEngine(g)
    const { next, spoken } = engine.press(atTheFight(engine), '1')
    expect(spoken).toContain('unwritten')
    expect(next.nodeId).toBe(idOf(g, 'B'))
  })
})
