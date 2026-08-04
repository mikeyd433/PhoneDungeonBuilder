import { describe, expect, it } from 'vitest'
import { audioTargets, matchFile, normaliseFileName } from './targets'
import { addCharacter, addFight, addLines, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

const STAMP = '2026-01-01T00:00:00Z'

const files = (g: StoryGraph) => audioTargets(g).map((t) => t.file)

describe('audioTargets', () => {
  it('asks for one file per room', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    expect(files(g)).toEqual(['CAVE', 'HALL'])
  })

  it('asks for a file per line once a room is split, not one for the room', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    addCharacter(g, 'mike')
    addLines(g, 'HALL', ['mike|Anyone there?', 'mike|Hello?'])
    expect(files(g)).toEqual(['CAVE', 'HALL__line1', 'HALL__line2'])
  })

  it('asks for a file per fight round', () => {
    const g = makeGraph(['PIT', 'WIN'], [])
    addFight(g, 'PIT', { moves: ['SWIM beats bite'], rounds: ['bite', 'thrash'], win: 'WIN' })
    expect(files(g)).toContain('PIT__r1')
    expect(files(g)).toContain('PIT__r2')
  })

  it('leaves items and the readback alone until the story has a reserved key', () => {
    const g = makeGraph(['HALL'], [])
    g.stateVars.set('v1', {
      id: 'v1',
      story_id: g.story.id,
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
      created_at: STAMP,
      updated_at: STAMP,
    })
    expect(files(g)).toEqual(['HALL'])

    g.story.inventory_key = '*'
    expect(files(g)).toEqual(['HALL', 'inventory__intro', 'inventory__empty', 'item__ROPE'])
  })

  it('carries the id needed to write the take back', () => {
    const g = makeGraph(['HALL'], [])
    const [target] = audioTargets(g)
    expect(target.ref).toEqual({ kind: 'room', nodeId: idOf(g, 'HALL') })
  })

  it('reports what is already recorded', () => {
    const g = makeGraph(['HALL'], [], { recorded: ['HALL'] })
    expect(audioTargets(g)[0].currentPath).toBe('audio/HALL.mp3')
  })
})

describe('normaliseFileName', () => {
  it.each([
    ['HALL.wav', 'HALL'],
    ['HALL.mp3', 'HALL'],
    ['hall.WAV', 'HALL'],
    ['HALL (1).wav', 'HALL'],
    ['HALL take 3.wav', 'HALL'],
    ['HALL_take3.wav', 'HALL'],
    ['HALL-TAKE-12.wav', 'HALL'],
    ['HALL_v2.wav', 'HALL'],
    ['  HALL  .wav', 'HALL'],
    ['HALL__line2.wav', 'HALL__LINE2'],
  ])('%j -> %j', (input, expected) => expect(normaliseFileName(input)).toBe(expected))

  it('does not eat a name that merely ends in a number', () => {
    // HOTLINE_9 is a room, not take 9 of HOTLINE.
    expect(normaliseFileName('HOTLINE_9.wav')).toBe('HOTLINE_9')
  })
})

describe('matchFile', () => {
  const graph = () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    addCharacter(g, 'mike')
    addLines(g, 'HALL', ['mike|Anyone there?'])
    return g
  }

  it('finds the room a file is named for', () => {
    expect(matchFile(audioTargets(graph()), 'CAVE.wav')?.key).toBe('CAVE')
  })

  it('finds a line', () => {
    expect(matchFile(audioTargets(graph()), 'HALL__line1.mp3')?.key).toBe('HALL#1')
  })

  it('forgives a take number and a download suffix', () => {
    expect(matchFile(audioTargets(graph()), 'cave take 2 (1).wav')?.key).toBe('CAVE')
  })

  it('claims nothing when nothing matches', () => {
    expect(matchFile(audioTargets(graph()), 'random-voice-memo.m4a')).toBeNull()
  })
})
