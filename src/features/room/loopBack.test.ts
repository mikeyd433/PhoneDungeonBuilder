import { describe, expect, it } from 'vitest'
import { loopTargets, matchCandidates, wayTo } from './loopBack'
import { deriveGraph } from '@/features/graph/derived'
import { idOf, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/** Entrance -> HUB -> two branches, the shape a looping middle actually has. */
const hubStory = () =>
  makeGraph(
    ['ENTRANCE', 'HUB', 'LEFT', 'RIGHT', 'DEEP', 'ELSEWHERE'],
    ['ENTRANCE>HUB', 'HUB>LEFT', 'HUB>RIGHT', 'LEFT>DEEP'],
  )

const groups = (g: StoryGraph, at: string, trail: string[] = []) =>
  loopTargets(g, deriveGraph(g), idOf(g, at), trail)

describe('the way here', () => {
  it('is the rooms between the entrance and this one, nearest first', () => {
    const g = hubStory()
    expect(wayTo(g, idOf(g, 'DEEP'))).toEqual([idOf(g, 'LEFT'), idOf(g, 'HUB'), idOf(g, 'ENTRANCE')])
  })

  it('is empty at the entrance, which is nobody’s descendant', () => {
    const g = hubStory()
    expect(wayTo(g, idOf(g, 'ENTRANCE'))).toEqual([])
  })

  it('is empty for a room the entrance cannot reach', () => {
    const g = hubStory()
    expect(wayTo(g, idOf(g, 'ELSEWHERE'))).toEqual([])
  })

  /** A fight's win and lose rooms are reached with no choice row at all, so a
   *  path built from choices alone would miss half the dungeon. */
  it('follows every edge, not only the doors', () => {
    const g = makeGraph(['ENTRANCE', 'PIT', 'SHORE'], ['ENTRANCE>PIT'])
    g.fights.set('f1', {
      id: 'f1',
      story_id: g.story.id,
      node_id: idOf(g, 'PIT'),
      opponent_name: 'The shark',
      win_node_id: idOf(g, 'SHORE'),
      lose_node_id: null,
      silence_patience: 3,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    expect(wayTo(g, idOf(g, 'SHORE'))).toEqual([idOf(g, 'PIT'), idOf(g, 'ENTRANCE')])
  })
})

describe('where a door can loop back to', () => {
  /**
   * The whole point. A 139-room alphabetical list buries the hub the author is
   * trying to get back to; the way they came is a handful of rooms and it is
   * almost always one of them.
   */
  it('offers the way back first, nearest first', () => {
    const g = hubStory()
    expect(groups(g, 'DEEP').wayHere.map((c) => c.slug)).toEqual(['LEFT', 'HUB', 'ENTRANCE'])
  })

  it('marks those as loops, because that is what they are', () => {
    const g = hubStory()
    expect(groups(g, 'DEEP').wayHere.every((c) => c.loops)).toBe(true)
  })

  it('offers where you have been next, most recent first', () => {
    const g = hubStory()
    const trail = [idOf(g, 'ENTRANCE'), idOf(g, 'HUB'), idOf(g, 'RIGHT')]
    expect(groups(g, 'DEEP', trail).visited.map((c) => c.slug)).toEqual(['RIGHT'])
  })

  it('never lists a room twice across the groups', () => {
    const g = hubStory()
    const trail = [idOf(g, 'ENTRANCE'), idOf(g, 'HUB'), idOf(g, 'RIGHT')]
    const { wayHere, visited, rest } = groups(g, 'DEEP', trail)
    const all = [...wayHere, ...visited, ...rest].map((c) => c.id)
    expect(new Set(all).size).toBe(all.length)
  })

  it('never offers the room the door leaves — that is a self-loop, not a way back', () => {
    const g = hubStory()
    const { wayHere, visited, rest } = groups(g, 'DEEP', [idOf(g, 'DEEP')])
    const all = [...wayHere, ...visited, ...rest].map((c) => c.id)
    expect(all).not.toContain(idOf(g, 'DEEP'))
  })

  it('still reaches every other room, through the rest', () => {
    const g = hubStory()
    const { wayHere, visited, rest } = groups(g, 'DEEP')
    const all = [...wayHere, ...visited, ...rest]
    expect(all).toHaveLength(g.nodes.size - 1)
    expect(rest.map((c) => c.slug).sort()).toEqual(['ELSEWHERE', 'RIGHT'])
  })

  it('does not call a sideways door a loop', () => {
    const g = hubStory()
    // RIGHT is not on DEEP's way here; wiring to it reconverges, it does not loop.
    expect(groups(g, 'DEEP').rest.find((c) => c.slug === 'RIGHT')!.loops).toBe(false)
  })
})

describe('finding one by typing', () => {
  const list = [
    { id: 'a', title: 'The flooded hold', slug: 'HOLD', depth: 1, loops: false },
    { id: 'b', title: 'The listing deck', slug: 'DECK', depth: 1, loops: false },
  ]

  it('matches the name', () => {
    expect(matchCandidates(list, 'flooded').map((c) => c.id)).toEqual(['a'])
  })

  /** After an import the slug is often all you remember. */
  it('matches the slug', () => {
    expect(matchCandidates(list, 'deck').map((c) => c.id)).toEqual(['b'])
  })

  it('asks nothing of the list when the box is empty', () => {
    expect(matchCandidates(list, '  ')).toHaveLength(2)
  })
})
