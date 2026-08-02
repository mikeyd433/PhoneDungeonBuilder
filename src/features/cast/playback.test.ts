import { describe, expect, it } from 'vitest'
import { addCharacter, addLines, idOf, makeGraph } from '@/test/factory'
import { isFullyRecorded, playbackFor, playsLineByLine } from './dialogue'
import { compileStory } from '@/features/export/compile'
import { deriveGraph } from '@/features/graph/derived'
import { buildRoomView } from '@/features/room/roomModel'

/** A two-hander: Carter and Mike, in one room, voiced by two people. */
function conversation(opts: { recorded?: boolean } = {}) {
  const g = makeGraph(['SCENE', 'NEXT'], ['SCENE>NEXT'])
  addCharacter(g, 'CARTER', { name: 'Carter', voice_actor: 'Sam' })
  addCharacter(g, 'MIKE', { name: 'Mike', voice_actor: 'Alex' })
  addLines(g, 'SCENE', ['CARTER|get in', 'MIKE|not yet'], opts)
  const node = [...g.nodes.values()].find((n) => n.slug === 'SCENE')!
  g.nodes.set(node.id, { ...node, narration: 'Carter: get in\nMike: not yet' })
  return g
}

describe('what a room plays', () => {
  it('is one piece when the lines have no takes of their own', () => {
    const g = conversation()
    const id = idOf(g, 'SCENE')
    expect(playsLineByLine(g, id)).toBe(false)
    expect(playbackFor(g, id)).toEqual([
      { id, audioPath: null, say: 'Carter: get in\nMike: not yet', speaker: null },
    ])
  })

  it('is line by line the moment a line carries a take', () => {
    const g = conversation({ recorded: true })
    const parts = playbackFor(g, idOf(g, 'SCENE'))
    expect(parts.map((p) => p.speaker)).toEqual(['Carter', 'Mike'])
    expect(parts.map((p) => p.say)).toEqual(['get in', 'not yet'])
    expect(parts.every((p) => p.audioPath)).toBe(true)
  })

  it('keeps an unrecorded line in the running order rather than dropping it', () => {
    // Half a conversation is worse than a spoken stand-in: the caller would
    // hear one side of an exchange and nothing explaining the gap.
    const g = conversation({ recorded: true })
    const [carters] = [...g.dialogue.values()]
    g.dialogue.set(carters.id, { ...carters, audio_path: null })
    const parts = playbackFor(g, idOf(g, 'SCENE'))
    expect(parts).toHaveLength(2)
    expect(parts[0].audioPath).toBeNull()
    expect(parts[0].say).toBe('get in')
  })
})

describe('a room is only lit when it is finished', () => {
  it('stays dark while one line is missing its take', () => {
    const g = conversation({ recorded: true })
    const [carters] = [...g.dialogue.values()]
    g.dialogue.set(carters.id, { ...carters, audio_path: null })
    expect(isFullyRecorded(g, idOf(g, 'SCENE'))).toBe(false)
    expect(buildRoomView(g, deriveGraph(g), idOf(g, 'SCENE'))!.torchLit).toBe(false)
  })

  it('lights once every line has one', () => {
    const g = conversation({ recorded: true })
    expect(buildRoomView(g, deriveGraph(g), idOf(g, 'SCENE'))!.torchLit).toBe(true)
  })
})

describe('compiling a conversation', () => {
  it('plays the lines in order and only then offers the exits', () => {
    const { widgets } = compileStory(conversation({ recorded: true }), 'https://audio/')
    const first = widgets.find((w) => w.name === 'SCENE_play')!
    const second = widgets.find((w) => w.name === 'SCENE_line2')!
    expect(first.playUrl).toContain('line-SCENE-0')
    expect(first.transitions[0].next).toBe('SCENE_line2')
    expect(second.playUrl).toContain('line-SCENE-1')
    expect(second.transitions[0].next).toBe('SCENE_gather')
  })

  it('stays one widget when the room records as one file', () => {
    const g = conversation()
    // Give the room itself a take, so it plays as a single file.
    const node = g.nodes.get(idOf(g, 'SCENE'))!
    g.nodes.set(node.id, { ...node, audio_path: 'audio/SCENE.mp3' })
    const { widgets } = compileStory(g, 'https://audio/')
    expect(widgets.find((w) => w.name === 'SCENE_line2')).toBeUndefined()
    expect(widgets.find((w) => w.name === 'SCENE_play')!.transitions[0].next).toBe('SCENE_gather')
  })

  it('skips a line with no take rather than reading it in a robot voice', () => {
    const g = conversation({ recorded: true })
    const [carters] = [...g.dialogue.values()]
    g.dialogue.set(carters.id, { ...carters, audio_path: null })
    const { warnings, widgets } = compileStory(g, 'https://audio/')
    expect(warnings.join(' ')).toContain('1 of its 2 lines have no take')
    // Only Mike's take is emitted, and it takes the first widget's name so
    // everything pointing at this room still lands somewhere real.
    const play = widgets.find((w) => w.name === 'SCENE_play')!
    expect(play.say).toBeUndefined()
    expect(play.playUrl).toContain('line-SCENE-1')
    expect(widgets.find((w) => w.name === 'SCENE_line2')).toBeUndefined()
  })
})
