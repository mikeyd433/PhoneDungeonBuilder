import { describe, expect, it } from 'vitest'
import { addFight, idOf, makeGraph, setOutcome, words, wordsOf } from '@/test/factory'
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

  it('repeats the round on silence before calling the fight', () => {
    // Callers hesitate. Three strikes by default, and the exported flow counts
    // the same way — a caller who never answers still loses eventually, so the
    // round cannot be waited out.
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    let state = atTheFight(engine)

    const first = engine.timeout(state)
    expect(first.next.nodeId).toBe(idOf(g, 'SHARKS'))
    expect(wordsOf(first)).toContain('Kick')
    state = first.next

    state = engine.timeout(state).next
    expect(state.nodeId).toBe(idOf(g, 'SHARKS'))

    expect(engine.timeout(state).next.nodeId).toBe(idOf(g, 'DROWNED'))
  })

  it('forgives the silences once the caller answers', () => {
    const g = sharkGraph()
    const engine = new PlaytestEngine(g)
    const waited = engine.timeout(engine.timeout(atTheFight(engine)).next).next
    expect(waited.fightSilences).toBe(2)
    // Answering round one correctly moves on with a clean slate.
    expect(engine.press(waited, '1').next.fightSilences).toBe(0)
  })

  it('respects a fight that gives only one chance', () => {
    const g = makeGraph(['ENTRANCE', 'SHARKS', 'DROWNED'], ['ENTRANCE>SHARKS'], {
      endings: ['DROWNED'],
    })
    addFight(g, 'SHARKS', {
      moves: ['PUNCH beats Kick'],
      rounds: ['Kick'],
      lose: 'DROWNED',
      patience: 1,
    })
    const engine = new PlaytestEngine(g)
    expect(engine.timeout(atTheFight(engine)).next.nodeId).toBe(idOf(g, 'DROWNED'))
  })

  it('goes where the round says when every move leads to the same place', () => {
    const g = sharkGraph()
    for (const move of [0, 1, 2]) setOutcome(g, 'SHARKS', 0, move, 'SHORE')
    const engine = new PlaytestEngine(g)
    for (const digit of ['1', '2', '3']) {
      expect(engine.press(atTheFight(engine), digit).next.nodeId).toBe(idOf(g, 'SHORE'))
    }
  })

  it('takes a named move where it was told, not where the counter rule would', () => {
    const g = sharkGraph()
    setOutcome(g, 'SHARKS', 0, 1, 'SHORE') // KICK, which would otherwise lose
    const engine = new PlaytestEngine(g)
    expect(engine.press(atTheFight(engine), '2').next.nodeId).toBe(idOf(g, 'SHORE'))
    // The moves left on the default still behave as they did.
    expect(engine.press(atTheFight(engine), '3').next.nodeId).toBe(idOf(g, 'DROWNED'))
  })

  it('says so rather than pretending when an outcome has nowhere to go', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    addFight(g, 'B', { moves: ['PUNCH beats Kick'], rounds: ['Kick'] })
    const engine = new PlaytestEngine(g)
    const { next, heard } = engine.press(atTheFight(engine), '1')
    expect(words(heard)).toContain('unwritten')
    expect(next.nodeId).toBe(idOf(g, 'B'))
  })
})

describe('the reserved inventory key', () => {
  const withKey = (g: ReturnType<typeof makeGraph>) => {
    g.story.inventory_key = '*'
    g.story.inventory_intro_audio_path = 'takes/carrying.mp3'
    g.story.inventory_empty_audio_path = 'takes/nothing.mp3'
    return g
  }
  const rope = (g: ReturnType<typeof makeGraph>, recorded: boolean) => {
    g.stateVars.set('v1', {
      id: 'v1',
      story_id: g.story.id,
      slug: 'ROPE',
      name: 'a coil of rope',
      kind: 'item',
      description: null,
      is_consumable: false,
      audio_path: recorded ? 'takes/rope.mp3' : null,
      audio_duration_ms: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
  }

  it('reads back without moving the caller', () => {
    const g = withKey(makeGraph(['HALL', 'CAVE'], ['HALL>CAVE']))
    rope(g, true)
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const { next, heard } = engine.press(start, '*')
    expect(next.nodeId).toBe(start.nodeId)
    expect(words(heard)).toMatch(/carrying nothing/i)
  })

  it('warns that an unrecorded item is silence on the phone', () => {
    const g = withKey(makeGraph(['HALL', 'CAVE'], ['HALL>CAVE']))
    rope(g, false)
    const engine = new PlaytestEngine(g)
    const state = engine.start()
    // Force the item into the satchel rather than walking a route to it.
    const carrying = { ...state, caller: { ...state.caller, mask: 1 } }
    const { heard } = engine.press(carrying, '*')
    expect(words(heard)).toMatch(/a coil of rope/)
    expect(words(heard)).toMatch(/no recording/i)
  })

  it('leaves the key alone when a room uses it for a door', () => {
    const g = withKey(makeGraph(['HALL', 'CAVE'], ['HALL>CAVE']))
    const id = [...g.choices.values()][0].id
    g.choices.set(id, { ...g.choices.get(id)!, digit: '*' })
    rope(g, true)
    const engine = new PlaytestEngine(g)
    const start = engine.start()
    const { next } = engine.press(start, '*')
    // The door wins: pressing * walks through it, exactly as the export does.
    expect(next.nodeId).not.toBe(start.nodeId)
  })
})
