import { describe, expect, it } from 'vitest'
import { PlaytestEngine } from './engine'
import {
  addCharacter,
  addFight,
  addReactionLines,
  choiceOf,
  idOf,
  makeGraph,
  setOutcome,
  words,
  wordsOf,
} from '@/test/factory'
import type { Gate, StoryGraph } from '@/types/domain'

/**
 * What the caller HEARS, in the order they hear it.
 *
 * Every case here was silent in the app before the engine returned one list.
 * The screen used to watch which ROOM was current and play that, while the
 * engine separately returned a string for the transcript — so a door's
 * reaction was printed and never played (the only branch that spoke it was the
 * branch where the caller had not moved, and walking through a door always
 * moves you), and every turn that left you where you were said nothing at all.
 */

const STAMP = '2024-01-01T00:00:00.000Z'

/** Two rooms, and a door between them that says something on the way. */
const script = (g: StoryGraph, slug: string, text: string) => {
  const n = g.nodes.get(idOf(g, slug))!
  g.nodes.set(n.id, { ...n, narration: text })
  return g
}

const doorway = () => {
  const g = makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL', 'VAULT'] })
  script(g, 'HALL', 'The hall.')
  script(g, 'VAULT', 'The vault.')
  const door = g.choices.get(choiceOf(g, 'HALL', 'VAULT'))!
  door.reaction_narration = 'The hinge gives.'
  door.audio_path = 'takes/hinge.mp3'
  return g
}

describe('a door with a reaction', () => {
  /** The reported bug: heard on the phone, printed in the log, never played. */
  it('is heard between the two rooms, in that order', () => {
    const g = doorway()
    const e = new PlaytestEngine(g)
    const turn = e.press(e.start(), '1')
    expect(turn.heard.map((p) => p.say)).toEqual(['The hinge gives.', 'The vault.'])
    expect(turn.next.nodeId).toBe(idOf(g, 'VAULT'))
  })

  it('carries its take, so a recorded reaction is played rather than spoken', () => {
    const g = doorway()
    const e = new PlaytestEngine(g)
    expect(e.press(e.start(), '1').heard[0].audioPath).toBe('takes/hinge.mp3')
  })

  /**
   * A reaction split by speaker reads as the exchange it is.
   *
   * `recorded`, because once the lines carry takes the single file on the
   * choice is no longer what plays — the same rule the torch follows. With
   * unrecorded lines the one file still wins, which is what the previous
   * version of this test accidentally asserted.
   */
  it('keeps its speakers, once the lines are the thing that plays', () => {
    const g = doorway()
    addCharacter(g, 'CARTER', { name: 'Carter' })
    addCharacter(g, 'MIKE', { name: 'Mike' })
    const door = choiceOf(g, 'HALL', 'VAULT')
    addReactionLines(g, door, ['CARTER|Don’t.', 'MIKE|Too late.'], { recorded: true })
    const e = new PlaytestEngine(g)
    const said = wordsOf(e.press(e.start(), '1'))
    expect(said).toContain('Carter: Don’t.')
    expect(said).toContain('Mike: Too late.')
  })
})

describe('a turn that leaves the caller where they were', () => {
  /** The room is re-read on the phone; the rehearsal used to fall silent,
   *  which is indistinguishable from the app having stopped working. */
  it('reads the room again on a wrong key', () => {
    const g = script(makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL'] }), 'HALL', 'The hall.')
    const e = new PlaytestEngine(g)
    const turn = e.press(e.start(), '9')
    expect(turn.next.nodeId).toBe(idOf(g, 'HALL'))
    expect(words(turn.heard)).toContain("That isn't one of the options.")
    expect(words(turn.heard)).toContain('The hall.')
  })

  it('reads the room again on a timeout with nowhere to go', () => {
    const g = script(makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL'] }), 'HALL', 'The hall.')
    const e = new PlaytestEngine(g)
    expect(words(e.timeout(e.start()).heard)).toContain('The hall.')
  })

  /** A door back into the room you are standing in. The screen watched for a
   *  CHANGE of room, so this one played nothing at all. */
  it('reads the room again when a door loops back to it', () => {
    const g = script(makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL'] }), 'HALL', 'The hall.')
    g.choices.get(choiceOf(g, 'HALL', 'VAULT'))!.to_node_id = idOf(g, 'HALL')
    const e = new PlaytestEngine(g)
    const turn = e.press(e.start(), '1')
    expect(turn.next.nodeId).toBe(idOf(g, 'HALL'))
    expect(words(turn.heard)).toContain('The hall.')
  })
})

describe('a refusal', () => {
  const locked = (): StoryGraph => {
    const g = script(makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL'] }), 'HALL', 'The hall.')
    const gate: Gate = {
      id: 'g1',
      story_id: g.story.id,
      choice_id: choiceOf(g, 'HALL', 'VAULT'),
      expression: { op: 'has', var: 'KEY' },
      fail_behavior: 'refuse',
      fail_narration: 'It will not budge.',
      fail_audio_path: 'takes/refuse.mp3',
      fail_audio_duration_ms: null,
      fail_node_id: null,
      consume_on_pass: false,
      created_at: STAMP,
      updated_at: STAMP,
    }
    g.gates.set(gate.id, gate)
    return g
  }

  /** A refusal is a line like any other, and it has a take. Reading it in a
   *  robot voice while a recording existed rehearsed the wrong scene. */
  it('plays the recorded refusal rather than speaking it', () => {
    const e = new PlaytestEngine(locked())
    const turn = e.press(e.start(), '1')
    expect(turn.heard).toHaveLength(1)
    expect(turn.heard[0].say).toBe('It will not budge.')
    expect(turn.heard[0].audioPath).toBe('takes/refuse.mp3')
  })

  /** And the room is NOT re-read: on the phone a refusal returns to the
   *  gather, not to the top of the scene. */
  it('does not read the whole room again', () => {
    const e = new PlaytestEngine(locked())
    expect(words(e.press(e.start(), '1').heard)).not.toContain('The hall.')
  })
})

describe('the reserved key', () => {
  it('says what is carried, then puts the caller back in the room', () => {
    const g = script(makeGraph(['HALL', 'VAULT'], ['HALL>VAULT'], { recorded: ['HALL'] }), 'HALL', 'The hall.')
    g.story.inventory_key = '*'
    const e = new PlaytestEngine(g)
    const turn = e.press(e.start(), '*')
    expect(turn.next.nodeId).toBe(idOf(g, 'HALL'))
    expect(words(turn.heard)).toContain('The hall.')
  })
})

describe('a fight', () => {
  /** Winning walks you into a room, and that room has to read itself out —
   *  it used to be left to the screen to notice the move. */
  it('reads the room it puts you in', () => {
    const g = makeGraph(['ARENA', 'AFTER'], [], { recorded: ['ARENA', 'AFTER'] })
    script(g, 'AFTER', 'After.')
    addFight(g, 'ARENA', { moves: ['DUCK'], rounds: ['swing'] })
    setOutcome(g, 'ARENA', 0, 0, 'AFTER')
    const e = new PlaytestEngine(g)
    const start = e.start()
    expect(start.fightRound).toBe(0)
    const turn = e.press(start, '1')
    expect(turn.next.nodeId).toBe(idOf(g, 'AFTER'))
    expect(words(turn.heard)).toContain('After.')
  })

  /** And walking INTO one reads the room, then the first round. */
  it('reads the lead-in before the first round', () => {
    const g = makeGraph(['HALL', 'ARENA'], ['HALL>ARENA'], { recorded: ['HALL', 'ARENA'] })
    script(g, 'ARENA', 'The arena.')
    addFight(g, 'ARENA', { moves: ['DUCK'], rounds: ['swing'] })
    const e = new PlaytestEngine(g)
    const said = words(e.press(e.start(), '1').heard)
    expect(said).toContain('The arena.')
    expect(said.indexOf('The arena.')).toBeLessThan(said.indexOf('throws a swing'))
  })
})
