import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveGraph } from './derived'
import { buildRoomView } from '@/features/room/roomModel'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Choice, StoryNode } from '@/types/domain'

/**
 * A door's label and the room behind it are two different pieces of writing.
 *
 * Chiselling used to copy the label into the new room's title, so a door
 * saying "enter the door" left a room called "Enter The Door" — and renaming
 * either one looked like it had not taken, because the other still said it.
 */
const { calls, rows } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; patch: Record<string, unknown> }>,
  rows: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/lib/api', () => ({
  createNode: vi.fn(async (storyId: string, patch: Partial<StoryNode>) => {
    calls.push({ fn: 'createNode', patch: patch as Record<string, unknown> })
    return { ...patch, id: 'new-node', story_id: storyId } as StoryNode
  }),
  updateChoice: vi.fn(async (id: string, patch: Partial<Choice>) => {
    const row = { ...(rows.get(id) ?? { id }), ...patch, id }
    rows.set(id, row)
    return row as unknown as Choice
  }),
  createChoice: vi.fn(),
  deleteNode: vi.fn(),
  loadStoryGraph: vi.fn(),
  myRole: vi.fn(),
}))

const { useDelve } = await import('./store')

function stand(g: ReturnType<typeof makeGraph>) {
  rows.clear()
  for (const c of g.choices.values()) rows.set(c.id, { ...c })
  useDelve.setState({
    graph: g,
    derived: deriveGraph(g),
    currentNodeId: idOf(g, 'HALL'),
    trail: [idOf(g, 'HALL')],
    demo: false,
    undoStack: [],
    error: null,
  })
}

/** A door with words on it and nowhere to go — the thing you chisel through. */
function doorTo(label: string) {
  const g = makeGraph(['HALL', 'SPARE'], ['HALL>SPARE', 'HALL>'])
  const unwired = [...g.choices.values()].find((c) => c.to_node_id === null)!
  g.choices.set(unwired.id, { ...unwired, label })
  return { g, choiceId: unwired.id }
}

describe('chiselling through a door', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('does not name the room after the door', async () => {
    const { g, choiceId } = doorTo('enter the door')
    stand(g)
    await useDelve.getState().createChildNode(choiceId)

    const created = calls.find((c) => c.fn === 'createNode')!.patch
    expect(created.title).toBe('')
  })

  it('still takes its slug from the label, because a slug is an identifier', async () => {
    const { g, choiceId } = doorTo('enter the door')
    stand(g)
    await useDelve.getState().createChildNode(choiceId)

    // ENTER_THE_DOOR is far easier to find in a bucket, or in the exported
    // flow's widget names, than ROOM_87.
    expect(calls.find((c) => c.fn === 'createNode')!.patch.slug).toBe('ENTER_THE_DOOR')
  })

  it('takes a title when one is given deliberately', async () => {
    const { g, choiceId } = doorTo('enter the door')
    stand(g)
    await useDelve.getState().createChildNode(choiceId, 'The Vestibule')

    const created = calls.find((c) => c.fn === 'createNode')!.patch
    expect(created.title).toBe('The Vestibule')
    expect(created.slug).toBe('THE_VESTIBULE')
  })

  it('leaves the door’s own label alone', async () => {
    const { g, choiceId } = doorTo('enter the door')
    stand(g)
    await useDelve.getState().createChildNode(choiceId)
    expect(rows.get(choiceId)?.label).toBe('enter the door')
  })
})

describe('a room with no name of its own', () => {
  it('is reported as unnamed rather than as being called its slug', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, title: '' })

    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'HALL'))!
    const exit = view.exits.find((e) => e.targetId === cave)!
    // The door still says where it goes...
    expect(exit.targetTitle).toBe('CAVE')
    // ...without claiming anybody named it that.
    expect(exit.targetTitled).toBe(false)
  })

  it('reports a real name as one', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, title: 'The dripping cave' })

    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'HALL'))!
    const exit = view.exits.find((e) => e.targetId === cave)!
    expect(exit.targetTitle).toBe('The dripping cave')
    expect(exit.targetTitled).toBe(true)
  })

  it('is not fooled by a title of only spaces', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, title: '   ' })

    const view = buildRoomView(g, deriveGraph(g), idOf(g, 'HALL'))!
    expect(view.exits.find((e) => e.targetId === cave)!.targetTitled).toBe(false)
  })

  it('keeps the door’s label independent of the room’s name', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const id = choiceOf(g, 'HALL', 'CAVE')
    g.choices.set(id, { ...g.choices.get(id)!, label: 'enter the door' })
    const cave = idOf(g, 'CAVE')
    g.nodes.set(cave, { ...g.nodes.get(cave)!, title: 'The Vestibule' })

    const exit = buildRoomView(g, deriveGraph(g), idOf(g, 'HALL'))!.exits.find(
      (e) => e.targetId === cave,
    )!
    expect(exit.label).toBe('enter the door')
    expect(exit.targetTitle).toBe('The Vestibule')
  })
})
