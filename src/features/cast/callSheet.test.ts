import { describe, expect, it } from 'vitest'
import { callSheets, callSheetText } from './callSheet'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addLines, choiceOf, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

function scene(): StoryGraph {
  const g = makeGraph(['ZERO', 'MIDDLE'], ['ZERO>MIDDLE'])
  addCharacter(g, 'carter', { name: 'Carter', voice_actor: 'Carter B' })
  addCharacter(g, 'mike', { name: 'Mike', voice_actor: 'Mike D' })
  addLines(g, 'ZERO', ['carter|You are bleeding.', 'mike|I know what I am.'])
  addLines(g, 'MIDDLE', ['carter|We are not doing that again.'])
  return g
}

const sheets = (g: StoryGraph) => callSheets(g, deriveGraph(g))
const forActor = (g: StoryGraph, actor: string) => sheets(g).find((s) => s.actor === actor)!

describe('a call sheet', () => {
  it('gives an actor their own lines and nobody else’s', () => {
    const carter = forActor(scene(), 'Carter B')
    expect(carter.lines.map((l) => l.text)).toEqual([
      'You are bleeding.',
      'We are not doing that again.',
    ])
  })

  it('runs in story order, not the order the lines were written', () => {
    const g = scene()
    // MIDDLE's line was added last but is deeper, so it stays last.
    expect(forActor(g, 'Carter B').lines.map((l) => l.where)).toEqual(['ZERO', 'MIDDLE'])
  })

  /**
   * The filename is the whole point of handing somebody this page: a folder of
   * takes named from it has to land without anybody renaming anything, so these
   * must be the strings the bulk importer matches on.
   */
  it('names each file the way the importer expects it back', () => {
    expect(forActor(scene(), 'Carter B').lines.map((l) => l.file)).toEqual([
      'ZERO__line1',
      'MIDDLE__line1',
    ])
  })

  /** One person often plays two characters; two sheets for one session is how a
   *  booking gets double-counted. */
  it('groups by actor, not by character', () => {
    const g = scene()
    const mike = g.characters.get('ch-mike')!
    g.characters.set(mike.id, { ...mike, voice_actor: 'Carter B' })
    const all = sheets(g)
    expect(all).toHaveLength(1)
    expect(all[0].characters).toEqual(['Carter', 'Mike'])
    expect(all[0].lines).toHaveLength(3)
  })

  it('keeps a recorded line on the sheet, marked, rather than dropping it', () => {
    const g = scene()
    const line = [...g.dialogue.values()].find((l) => l.text === 'You are bleeding.')!
    g.dialogue.set(line.id, { ...line, audio_path: 'takes/one.wav' })

    const carter = forActor(g, 'Carter B')
    expect(carter.lines).toHaveLength(2)
    expect(carter.lines[0].done).toBe(true)
    // ...but it is not counted against what is still owed.
    expect(carter.outstanding).toBe(1)
  })

  it('puts an uncast actor last — that is a casting problem, not a session', () => {
    const g = scene()
    const carter = g.characters.get('ch-carter')!
    g.characters.set(carter.id, { ...carter, voice_actor: null })
    expect(sheets(g)[sheets(g).length - 1].actor).toBeNull()
  })

  it('has nothing to say about a room read as one block', () => {
    // Nobody is cast for an unsplit room, so it belongs on no sheet — it is
    // booked for whoever is in the room, which is not recorded anywhere.
    const g = makeGraph(['ZERO'], [])
    expect(sheets(g)).toEqual([])
  })

  it('ignores a door’s reaction until somebody is cast in it', () => {
    const g = scene()
    const door = choiceOf(g, 'ZERO', 'MIDDLE')
    g.choices.set(door, { ...g.choices.get(door)!, reaction_narration: 'The hatch fights you.' })
    expect(sheets(g).flatMap((s) => s.lines).some((l) => l.file.includes('react'))).toBe(false)
    expect(idOf(g, 'ZERO')).toBeTruthy()
  })
})

describe('the sheet as something you can send', () => {
  it('lists only what is left to record', () => {
    const g = scene()
    const line = [...g.dialogue.values()].find((l) => l.text === 'You are bleeding.')!
    g.dialogue.set(line.id, { ...line, audio_path: 'takes/one.wav' })

    const text = callSheetText(forActor(g, 'Carter B'), 'The Hotline')
    expect(text).toContain('MIDDLE__line1')
    expect(text).not.toContain('ZERO__line1')
    expect(text).toContain('We are not doing that again.')
  })

  it('says who it is for and how long it will take', () => {
    const text = callSheetText(forActor(scene(), 'Carter B'), 'The Hotline')
    expect(text).toContain('The Hotline — call sheet for Carter B')
    expect(text).toContain('Playing: Carter')
    expect(text).toMatch(/2 still to record/)
  })
})
