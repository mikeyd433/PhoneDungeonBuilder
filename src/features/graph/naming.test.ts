import { beforeEach, describe, expect, it, vi } from 'vitest'
import { slugFollowingTitle } from './naming'
import { deriveGraph } from './derived'
import { idOf, makeGraph } from '@/test/factory'
import type { Choice, StoryNode } from '@/types/domain'

/**
 * A room chiselled through a door borrows that door's words for its slug, and
 * the slug is not cosmetic: it is the widget name in the exported flow and the
 * filename an actor is asked for. Left alone it made "enter door" the room's
 * permanent identity — relabel the door, rename the room, and the old wording
 * was still there in the bucket and in Studio.
 */
describe('naming a room', () => {
  const named = (title: string, patch: Partial<StoryNode> = {}) => {
    const g = makeGraph(['HALL', 'ENTER_THE_DOOR'], ['HALL>ENTER_THE_DOOR'])
    const id = idOf(g, 'ENTER_THE_DOOR')
    const before = { ...g.nodes.get(id)!, title: '' }
    g.nodes.set(id, before)
    return slugFollowingTitle(g, before, { title, ...patch })
  }

  it('moves the slug off the door label the first time it is named', () => {
    expect(named('The Vestibule')).toBe('THE_VESTIBULE')
  })

  it('leaves a room that already had a name alone', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const before = g.nodes.get(idOf(g, 'CAVE'))!
    // Its slug is out in the world by now — in a manifest an actor is holding,
    // and in a flow already imported into Studio.
    expect(before.title.trim()).not.toBe('')
    expect(slugFollowingTitle(g, before, { title: 'The dripping cave' })).toBeNull()
  })

  it('does not fight a slug the author set in the same breath', () => {
    expect(named('The Vestibule', { slug: 'ACT2_START' })).toBeNull()
  })

  it('ignores a write that is not a rename', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const before = { ...g.nodes.get(idOf(g, 'CAVE'))!, title: '' }
    expect(slugFollowingTitle(g, before, { narration: 'Water to the ankle.' })).toBeNull()
  })

  it('treats clearing the name as no rename at all', () => {
    expect(named('   ')).toBeNull()
  })

  it('would rather keep the door’s words than end up with no slug', () => {
    // slugify strips this to nothing, and a room with no slug is worse than one
    // still named after a door.
    expect(named('!!!')).toBeNull()
  })

  it('does not collide with a room that already holds that slug', () => {
    const g = makeGraph(['HALL', 'ENTER_THE_DOOR', 'THE_VESTIBULE'], ['HALL>ENTER_THE_DOOR'])
    const id = idOf(g, 'ENTER_THE_DOOR')
    const before = { ...g.nodes.get(id)!, title: '' }
    g.nodes.set(id, before)
    expect(slugFollowingTitle(g, before, { title: 'The Vestibule' })).toBe('THE_VESTIBULE_2')
  })
})

// ------------------------------------------------------- through the store

const { calls, rows } = vi.hoisted(() => ({
  calls: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  rows: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/lib/api', () => ({
  updateNode: vi.fn(async (id: string, patch: Partial<StoryNode>) => {
    calls.push({ id, patch: patch as Record<string, unknown> })
    const row = { ...(rows.get(id) ?? { id }), ...patch, id }
    rows.set(id, row)
    return row as unknown as StoryNode
  }),
  updateChoice: vi.fn(async (id: string, patch: Partial<Choice>) => ({
    ...(rows.get(id) ?? { id }),
    ...patch,
    id,
  })),
  createNode: vi.fn(),
  createChoice: vi.fn(),
  deleteNode: vi.fn(),
  loadStoryGraph: vi.fn(),
  myRole: vi.fn(),
}))

const { useDelve } = await import('./store')

describe('renaming a room through the store', () => {
  beforeEach(() => {
    calls.length = 0
    rows.clear()
  })

  const stand = (title: string) => {
    const g = makeGraph(['HALL', 'ENTER_THE_DOOR'], ['HALL>ENTER_THE_DOOR'])
    const id = idOf(g, 'ENTER_THE_DOOR')
    g.nodes.set(id, { ...g.nodes.get(id)!, title })
    for (const n of g.nodes.values()) rows.set(n.id, { ...n })
    useDelve.setState({
      graph: g,
      derived: deriveGraph(g),
      currentNodeId: idOf(g, 'HALL'),
      trail: [idOf(g, 'HALL')],
      demo: false,
      undoStack: [],
      error: null,
    })
    return id
  }

  it('carries the new slug into the write', async () => {
    const id = stand('')
    await useDelve.getState().updateNode(id, { title: 'The Vestibule' })
    expect(calls[0].patch).toMatchObject({ title: 'The Vestibule', slug: 'THE_VESTIBULE' })
    expect(useDelve.getState().graph!.nodes.get(id)!.slug).toBe('THE_VESTIBULE')
  })

  it('undoes the slug along with the name, not half of it', async () => {
    const id = stand('')
    await useDelve.getState().updateNode(id, { title: 'The Vestibule' })
    await useDelve.getState().undo()
    const restored = calls[calls.length - 1].patch
    expect(restored).toMatchObject({ title: '', slug: 'ENTER_THE_DOOR' })
  })

  it('leaves an already-named room’s slug where it is', async () => {
    const id = stand('The old name')
    await useDelve.getState().updateNode(id, { title: 'A better name' })
    expect(calls[0].patch.slug).toBeUndefined()
    expect(useDelve.getState().graph!.nodes.get(id)!.slug).toBe('ENTER_THE_DOOR')
  })
})
