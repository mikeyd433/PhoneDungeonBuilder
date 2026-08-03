import { describe, expect, it } from 'vitest'
import { buildBrainstormPlan, type BrainstormExport } from './brainstorm'
import { slugPrefixes, splitAt, suggestSplit } from './split'

const node = (id: string, label: string, details?: string) => ({
  id,
  type: 'editableNode',
  data: { label, color: 'default', ...(details ? { details } : {}) },
})
const edge = (source: string, target: string) => ({ id: `e-${source}-${target}`, source, target })

/**
 * The real shape: a phone menu that hands off to a dungeon once the caller
 * picks a character.
 */
const hotlineThenDungeon = (): BrainstormExport => ({
  nodes: [
    node('h0', 'Thank you for calling. To stream our music, press 1.', 'HOTLINE_0'),
    node('h1', 'Streaming', 'HOTLINE_1'),
    node('h9', 'press 1 to play as Mike, press 2 to play as Carter', 'HOTLINE_9'),
    node('opt', '1.Play as Carter'),
    node('c0', 'Press 1 to open the door and enter the dungeon.', 'CARTER_INTRO_0'),
    node('c1', 'The door creaks open.', 'CARTER_INTRO_1'),
    node('s1', 'A shark fin breaks the water.', 'SHARKS_1'),
  ],
  edges: [
    edge('h0', 'h1'),
    edge('h0', 'h9'),
    edge('h9', 'opt'),
    edge('opt', 'c0'),
    edge('c0', 'c1'),
    edge('c1', 's1'),
  ],
})

describe('slugPrefixes', () => {
  it('counts the sections the author already named', () => {
    expect(slugPrefixes(hotlineThenDungeon())).toEqual([
      { prefix: 'HOTLINE', count: 3 },
      { prefix: 'CARTER_INTRO', count: 2 },
      { prefix: 'SHARKS', count: 1 },
    ])
  })
})

describe('suggestSplit', () => {
  it('finds the handoff out of the leading section', () => {
    const s = suggestSplit(hotlineThenDungeon())!
    expect(s.cutId).toBe('h9')
    // Names the section the FIRST story is, which is what titles it.
    expect(s.leadingPrefix).toBe('HOTLINE')
  })

  it('makes the character choice the dungeon’s first room', () => {
    // Picking Mike or Carter branches immediately, so it is the game's first
    // real decision — not a trailing step of the phone menu.
    const s = suggestSplit(hotlineThenDungeon())!
    expect(s.downstream.has('h9')).toBe(true)
    expect(s.upstream.has('h9')).toBe(false)
  })

  it('anchors on the section the caller starts in, not the biggest one', () => {
    // SHARKS has the most rooms written, but the call begins at HOTLINE_0.
    // Anchoring on size would cut the story mid-dungeon.
    const data = hotlineThenDungeon()
    for (let i = 2; i <= 8; i++) {
      data.nodes.push(node(`s${i}`, `shark ${i}`, `SHARKS_${i}`))
      data.edges.push(edge('s1', `s${i}`))
    }
    const s = suggestSplit(data)!
    expect(s.cutId).toBe('h9')
    expect(s.upstream.has('h0')).toBe(true)
    expect(s.downstream.has('s1')).toBe(true)
  })

  it('puts the whole dungeon downstream and the whole menu upstream', () => {
    const s = suggestSplit(hotlineThenDungeon())!
    expect([...s.downstream].sort()).toEqual(['c0', 'c1', 'h9', 'opt', 's1'])
    expect(s.upstream.has('h0')).toBe(true)
    expect(s.upstream.has('h1')).toBe(true)
  })

  it('records the crossing rather than dropping it', () => {
    const s = suggestSplit(hotlineThenDungeon())!
    expect(s.crossings).toEqual([{ fromId: 'h0', toId: 'h9' }])
  })

  it('leaves an ordinary one-section graph alone', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A', 'ROOM_1'), node('b', 'B', 'ROOM_2')],
      edges: [edge('a', 'b')],
    }
    expect(suggestSplit(data)).toBeNull()
  })

  it('does not split when one side would be almost empty', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A', 'MENU_1'), node('b', 'B', 'GAME_1')],
      edges: [edge('a', 'b')],
    }
    expect(suggestSplit(data)).toBeNull()
  })
})

describe('splitAt', () => {
  it('gives a shared room to the downstream story, so the dungeon has no holes', () => {
    // `shared` is reachable from both sides; the dungeon needs it intact.
    const data: BrainstormExport = {
      nodes: [
        node('menu', 'Menu', 'HOTLINE_0'),
        node('game', 'Game', 'GAME_0'),
        node('shared', 'Shared room', 'GAME_9'),
      ],
      edges: [edge('menu', 'game'), edge('game', 'shared'), edge('menu', 'shared')],
    }
    const s = splitAt(data, 'game')
    expect(s.downstream.has('shared')).toBe(true)
    expect(s.upstream.has('shared')).toBe(false)
    expect(s.crossings).toContainEqual({ fromId: 'menu', toId: 'shared' })
  })
})

describe('importing each side of a split', () => {
  const data = hotlineThenDungeon()
  const split = suggestSplit(data)!
  // This fixture is too small to trip the auto-collapse threshold; the real
  // graph is 44% option nodes, so state the intent explicitly here.
  const collapse = { collapseChoiceNodes: true }

  it('imports only its own rooms', () => {
    const menu = buildBrainstormPlan(data, { ...collapse, restrictTo: split.upstream })
    const game = buildBrainstormPlan(data, { ...collapse, restrictTo: split.downstream })
    expect(menu.nodes.map((n) => n.slug)).toEqual(['HOTLINE_0', 'HOTLINE_1'])
    expect(game.nodes.map((n) => n.slug)).toEqual([
      'HOTLINE_9',
      'CARTER_INTRO_0',
      'CARTER_INTRO_1',
      'SHARKS_1',
    ])
  })

  it('keeps the handoff visible as a bricked archway naming its destination', () => {
    // Losing this silently would hide the fact that the menu leads anywhere.
    const menu = buildBrainstormPlan(data, {
      ...collapse,
      restrictTo: split.upstream,
      otherStoryName: 'The Hotline',
    })
    // HOTLINE_0 has two exits: one stays in the menu, one crosses the boundary.
    const handoff = menu.choices.find((c) => !c.toSlug)!
    expect(handoff.fromSlug).toBe('HOTLINE_0')
    expect(handoff.unresolvedName).toBe('HOTLINE_9')
    expect(menu.issues.some((i) => i.message.includes('The Hotline'))).toBe(true)
  })

  it('starts the dungeon at the cut node', () => {
    const game = buildBrainstormPlan(data, { ...collapse, restrictTo: split.downstream })
    expect(game.rootSlug).toBe('HOTLINE_9')
  })

  it('imports the whole graph as one story when not split', () => {
    expect(buildBrainstormPlan(data, collapse).nodes).toHaveLength(6)
  })
})
