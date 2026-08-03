import { describe, expect, it } from 'vitest'
import { buildRoomView } from './roomModel'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addLines, idOf, makeGraph } from '@/test/factory'
import type { FigureKind, StoryGraph } from '@/types/domain'

function scene(figures: Record<string, FigureKind | null>) {
  const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
  for (const [slug, figure] of Object.entries(figures)) {
    addCharacter(g, slug, { name: slug[0].toUpperCase() + slug.slice(1), figure })
  }
  return g
}
const figuresAt = (g: StoryGraph, slug: string) =>
  buildRoomView(g, deriveGraph(g), idOf(g, slug))!.figures

describe('who is standing in the room', () => {
  /**
   * The whole point of it being opt-in. "Who speaks" and "who is present" are
   * different questions: the caller IS the party, and the narrator is nobody,
   * so drawing every voice would put three people in a room you are alone in.
   */
  it('draws nobody for the party or the narrator', () => {
    const g = scene({ mike: null, carter: null })
    addLines(g, 'HALL', ['mike|We should go back.', 'carter|We should not.', 'Nobody says this.'])
    expect(figuresAt(g, 'HALL')).toEqual([])
  })

  it('stands up whoever has been given one', () => {
    const g = scene({ mike: null, innkeeper: 'standing' })
    addLines(g, 'HALL', ['mike|Hello.', 'innkeeper|We are closed.'])
    expect(figuresAt(g, 'HALL').map((f) => f.name)).toEqual(['Innkeeper'])
  })

  /** Somebody with four lines is one person standing there, not four. */
  it('counts a character once however often they speak', () => {
    const g = scene({ innkeeper: 'standing' })
    addLines(g, 'HALL', ['innkeeper|One.', 'innkeeper|Two.', 'innkeeper|Three.'])
    expect(figuresAt(g, 'HALL')).toHaveLength(1)
  })

  it('puts them in the order they first speak', () => {
    const g = scene({ shark: 'beast', innkeeper: 'standing' })
    addLines(g, 'HALL', ['innkeeper|First.', 'shark|Second.', 'innkeeper|Again.'])
    expect(figuresAt(g, 'HALL').map((f) => f.name)).toEqual(['Innkeeper', 'Shark'])
  })

  it('carries the speaker’s own colour, so the figure and the words match', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    addCharacter(g, 'innkeeper', { name: 'Innkeeper', figure: 'looming', color: 'grave' })
    addLines(g, 'HALL', ['innkeeper|We are closed.'])
    expect(figuresAt(g, 'HALL')[0]).toMatchObject({ color: 'grave', kind: 'looming' })
  })

  it('leaves a room nobody speaks in empty', () => {
    const g = scene({ innkeeper: 'standing' })
    addLines(g, 'HALL', ['innkeeper|Only here.'])
    expect(figuresAt(g, 'CAVE')).toEqual([])
  })

  /** A reaction is heard in a doorway, not in a room — nobody is standing in
   *  the room for it, and the room's own figures must not pick it up. */
  it('ignores a line that belongs to a door', () => {
    const g = scene({ innkeeper: 'standing' })
    const hall = idOf(g, 'HALL')
    const choice = [...g.choices.values()][0]
    g.dialogue.set('dl-x', {
      id: 'dl-x',
      story_id: g.story.id,
      node_id: null,
      choice_id: choice.id,
      character_id: 'ch-innkeeper',
      text: 'Mind the step.',
      sort_order: 0,
      audio_path: null,
      audio_duration_ms: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    expect(buildRoomView(g, deriveGraph(g), hall)!.figures).toEqual([])
  })
})
