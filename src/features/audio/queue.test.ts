import { describe, expect, it } from 'vitest'
import { inStoryOrder, progressOf, roomOf } from './queue'
import { audioTargets } from './targets'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addLines, addReactionLines, choiceOf, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/** A short story, deliberately named so alphabetical order is the WRONG order. */
function story(): StoryGraph {
  const g = makeGraph(['ZERO', 'MIDDLE', 'ALPHA'], ['ZERO>MIDDLE', 'MIDDLE>ALPHA'])
  for (const slug of ['ZERO', 'MIDDLE', 'ALPHA']) {
    const id = idOf(g, slug)
    g.nodes.set(id, { ...g.nodes.get(id)!, narration: `You are in ${slug}.` })
  }
  return g
}

const order = (g: StoryGraph) =>
  inStoryOrder(audioTargets(g), g, deriveGraph(g)).map((t) => t.key)

describe('the recording queue', () => {
  /**
   * The whole reason this exists. `audioTargets` sorts by slug, which is right
   * for a manifest you scan and wrong for a session you work through — an actor
   * reads front to back, and jumping between act three and the prologue every
   * other take is how a performance loses its thread.
   */
  it('runs from the entrance outward, not alphabetically', () => {
    expect(order(story())).toEqual(['ZERO', 'MIDDLE', 'ALPHA'])
  })

  it('keeps a room’s own parts together, its lines before its doors', () => {
    const g = story()
    addCharacter(g, 'carter', { name: 'Carter' })
    addLines(g, 'ZERO', ['carter|First.', 'carter|Second.'])
    const door = choiceOf(g, 'ZERO', 'MIDDLE')
    g.choices.set(door, { ...g.choices.get(door)!, reaction_narration: 'The hatch fights you.' })

    const keys = order(g)
    // Both of ZERO's lines, then its door's reaction, then the next room.
    expect(keys.slice(0, 4)).toEqual(['ZERO#1', 'ZERO#2', 'ZERO#d1react', 'MIDDLE'])
  })

  it('sorts a room the entrance cannot reach to the back rather than dropping it', () => {
    const g = story()
    const lost = idOf(g, 'ALPHA')
    // Cut it off: nothing reaches ALPHA now.
    for (const [id, c] of g.choices) if (c.to_node_id === lost) g.choices.delete(id)

    const keys = order(g)
    expect(keys).toContain('ALPHA')
    expect(keys[keys.length - 1]).toBe('ALPHA')
  })

  it('puts the flat list — items, the inventory lead-in — at the end', () => {
    const g = story()
    g.story = { ...g.story, inventory_key: '*' }
    const keys = order(g)
    expect(keys.slice(-2)).toEqual(['inventory#intro', 'inventory#empty'])
  })

  it('loses nothing on the way through', () => {
    const g = story()
    addCharacter(g, 'carter', { name: 'Carter' })
    addLines(g, 'MIDDLE', ['carter|A line.'])
    g.story = { ...g.story, inventory_key: '#' }
    expect(order(g)).toHaveLength(audioTargets(g).length)
  })
})

describe('which room a slot is heard in', () => {
  it('finds the room behind a line', () => {
    const g = story()
    addCharacter(g, 'carter', { name: 'Carter' })
    const [line] = addLines(g, 'MIDDLE', ['carter|A line.'])
    const target = audioTargets(g).find((t) => t.ref.kind === 'line')!
    expect(roomOf(g, target)).toBe(idOf(g, 'MIDDLE'))
    expect(line.node_id).toBe(idOf(g, 'MIDDLE'))
  })

  /** A reaction happens in a doorway, so it is heard in the room you LEAVE —
   *  which is where the actor has to be standing in the session. */
  it('files a door’s reaction under the room it leaves', () => {
    const g = story()
    const door = choiceOf(g, 'ZERO', 'MIDDLE')
    g.choices.set(door, { ...g.choices.get(door)!, reaction_narration: 'The hatch fights you.' })
    const target = audioTargets(g).find((t) => t.kind === 'reaction')!
    expect(roomOf(g, target)).toBe(idOf(g, 'ZERO'))
  })

  it('files a reaction’s lines there too', () => {
    const g = story()
    const door = choiceOf(g, 'ZERO', 'MIDDLE')
    g.choices.set(door, { ...g.choices.get(door)!, reaction_narration: 'x' })
    addCharacter(g, 'carter', { name: 'Carter' })
    addReactionLines(g, door, ['carter|Careful.'])
    const target = audioTargets(g).find((t) => t.file.includes('__react__line1'))!
    expect(roomOf(g, target)).toBe(idOf(g, 'ZERO'))
  })

  it('has no room for an item’s name', () => {
    const g = story()
    g.story = { ...g.story, inventory_key: '*' }
    const target = audioTargets(g).find((t) => t.kind === 'inventory')!
    expect(roomOf(g, target)).toBeNull()
  })
})

describe('progress', () => {
  it('counts takes and adds up how long the story runs', () => {
    const g = story()
    const zero = idOf(g, 'ZERO')
    g.nodes.set(zero, { ...g.nodes.get(zero)!, audio_path: 'a.wav', audio_duration_ms: 2500 })
    const p = progressOf(audioTargets(g))
    expect(p).toEqual({ done: 1, total: 3, recordedMs: 2500 })
  })

  it('survives a take whose length was never measured', () => {
    const g = story()
    const zero = idOf(g, 'ZERO')
    g.nodes.set(zero, { ...g.nodes.get(zero)!, audio_path: 'a.wav', audio_duration_ms: null })
    expect(progressOf(audioTargets(g)).recordedMs).toBe(0)
  })
})
