import { describe, expect, it } from 'vitest'
import { findRooms, surveyStory } from './survey'
import { nameLines } from './labels'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addLines, idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

const survey = (g: StoryGraph) => surveyStory(g, deriveGraph(g))
const band = (g: StoryGraph, key: string) => survey(g).bands.find((b) => b.key === key)!

describe('surveying a story', () => {
  it('sorts every room into exactly one state of doneness', () => {
    const g = makeGraph(['HALL', 'CAVE', 'DEEP'], ['HALL>CAVE', 'CAVE>DEEP'], {
      recorded: ['HALL'],
    })
    // CAVE is written but unrecorded; DEEP has nothing in it at all.
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, narration: 'Water to the ankle.' })
    const deep = idOf(g, 'DEEP')
    g.nodes.set(deep, { ...g.nodes.get(deep)!, narration: '   ' })

    expect(band(g, 'recorded').ids).toEqual(new Set([idOf(g, 'HALL')]))
    expect(band(g, 'written').ids).toEqual(new Set([idOf(g, 'CAVE')]))
    expect(band(g, 'stub').ids).toEqual(new Set([deep]))
    // No room counted twice, and none missed.
    const total = ['recorded', 'written', 'stub'].reduce((n, k) => n + band(g, k).ids.size, 0)
    expect(total).toBe(survey(g).rooms)
  })

  /** A room with no narration of its own but a script split into lines is
   *  written — reading `narration` alone would report a whole cast scene as an
   *  empty room. */
  it('counts a room written as lines as written', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, narration: '' })
    addCharacter(g, 'carter', { name: 'Carter' })
    addLines(g, 'CAVE', ['carter|We are not doing that again.'])

    expect(band(g, 'stub').ids.has(cave)).toBe(false)
    expect(band(g, 'written').ids.has(cave)).toBe(true)
  })

  it('names the rooms behind a door that leads nowhere, and counts the doors', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE', 'HALL>', 'HALL>'])
    expect(survey(g).unwrittenBranches).toBe(2)
    // Two loose doors, but one room to go and fix them in.
    expect(band(g, 'unwritten').ids).toEqual(new Set([idOf(g, 'HALL')]))
  })

  it('folds orphans in with the unreachable — to an author they are one problem', () => {
    const g = makeGraph(['HALL', 'CAVE', 'LOST'], ['HALL>CAVE'])
    expect(band(g, 'unreachable').ids.has(idOf(g, 'LOST'))).toBe(true)
  })

  it('reports how much of the story is done', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'], { recorded: ['HALL'] })
    expect(survey(g).recordedFraction).toBe(0.5)
  })

  /** Every tally is tappable, and tapping it lights those rooms up — so a band
   *  naming an id the map has no room for would highlight nothing at all. */
  it('offers no tally it cannot act on', () => {
    const g = makeGraph(['HALL', 'CAVE', 'LOST'], ['HALL>CAVE', 'HALL>'], { recorded: ['HALL'] })
    for (const b of survey(g).bands) {
      expect(b.hint.trim().length, `${b.key} has no hint`).toBeGreaterThan(0)
      for (const id of b.ids) {
        expect(g.nodes.has(id), `${b.key} names ${id}, which is not a room`).toBe(true)
      }
    }
  })
})

describe('finding a room', () => {
  const g = () => {
    const graph = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const cave = idOf(graph, 'CAVE')
    graph.nodes.set(cave, {
      ...graph.nodes.get(cave)!,
      title: 'The dripping cave',
      narration: 'Tony skates away into the dark.',
    })
    return graph
  }

  it('matches the name', () => {
    expect(findRooms(g(), 'dripping')).toEqual(new Set([idOf(g(), 'CAVE')]))
  })

  /** In a story imported from a flowchart you remember a room by what happens
   *  in it long before you remember what it is called. */
  it('matches what happens in it', () => {
    expect(findRooms(g(), 'tony skates')).toEqual(new Set([idOf(g(), 'CAVE')]))
  })

  it('matches a spoken line', () => {
    const graph = g()
    addCharacter(graph, 'carter', { name: 'Carter' })
    addLines(graph, 'HALL', ['carter|You forgot your helmet!'])
    expect(findRooms(graph, 'helmet')?.has(idOf(graph, 'HALL'))).toBe(true)
  })

  it('still finds a room by its slug, for when that is what you have', () => {
    expect(findRooms(g(), 'HALL')?.has(idOf(g(), 'HALL'))).toBe(true)
  })

  it('asks nothing of the map when the box is empty', () => {
    expect(findRooms(g(), '   ')).toBeNull()
  })
})

describe('a room’s label on the map', () => {
  it('prefers the name over the identifier', () => {
    expect(nameLines({ title: 'The listing deck', slug: 'PRESS_1_TO_TURN' })).toEqual([
      'The listing',
      'deck',
    ])
  })

  it('falls back to the slug when nothing has named it', () => {
    expect(nameLines({ title: '', slug: 'CAVE' })).toEqual(['CAVE'])
  })

  /** A trimmed name has to look trimmed, or it reads as the whole name. */
  it('says when it has run out of room', () => {
    const lines = nameLines({ title: 'The long dark corridor beneath the hold', slug: 'X' })
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('breaks a single unbreakable word rather than overflowing', () => {
    const [line] = nameLines({ title: '', slug: 'A_VERY_LONG_SLUG_INDEED_YES' })
    expect(line.length).toBeLessThanOrEqual(15)
    expect(line.endsWith('…')).toBe(true)
  })

  it('has nothing to draw for a room with neither', () => {
    expect(nameLines({ title: '', slug: '' })).toEqual([])
  })
})
