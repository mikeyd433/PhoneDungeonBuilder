import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveGraph } from './derived'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Choice, StoryNode } from '@/types/domain'

/**
 * Inserting touches three rows in an order that matters, so the calls are
 * recorded and asserted rather than only the end state.
 *
 * `rows` mirrors what a real PATCH returns: the WHOLE row, not just the fields
 * that changed. A mock that returned only the patch dropped `from_node_id` back
 * into the store, which quietly emptied the graph — a bug in the double, not in
 * the code, but one that would have hidden a genuine failure.
 */
const { calls, rows } = vi.hoisted(() => ({
  calls: [] as string[],
  rows: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@/lib/api', () => ({
  createNode: vi.fn(async (storyId: string, patch: Partial<StoryNode>) => {
    calls.push(`createNode:${patch.slug}`)
    return { ...patch, id: 'new-node', story_id: storyId } as StoryNode
  }),
  createChoice: vi.fn(async (storyId: string, patch: Partial<Choice>) => {
    calls.push(`createChoice:${patch.from_node_id}->${patch.to_node_id}`)
    const row = { ...patch, id: 'bridge', story_id: storyId }
    rows.set('bridge', row)
    return row as Choice
  }),
  updateChoice: vi.fn(async (id: string, patch: Partial<Choice>) => {
    calls.push(`updateChoice:${id}->${patch.to_node_id}`)
    const row = { ...(rows.get(id) ?? { id }), ...patch, id }
    rows.set(id, row)
    return row as unknown as Choice
  }),
  deleteNode: vi.fn(async (id: string) => {
    calls.push(`deleteNode:${id}`)
  }),
  loadStoryGraph: vi.fn(),
  myRole: vi.fn(),
}))

const { useDelve } = await import('./store')

const graph = () => makeGraph(['HALL', 'CELL'], ['HALL>CELL'])

function stand(g: ReturnType<typeof graph>) {
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

describe('insertRoomOnChoice', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('builds forwards, then repoints the original door', async () => {
    const g = graph()
    stand(g)
    const id = await useDelve.getState().insertRoomOnChoice(choiceOf(g, 'HALL', 'CELL'), 'The landing')
    expect(id).toBe('new-node')

    // The new room and its way onward exist BEFORE the original door moves, so
    // a failure part-way can only leave a stray room, never a dead end.
    expect(calls).toEqual([
      'createNode:THE_LANDING',
      `createChoice:new-node->${idOf(g, 'CELL')}`,
      `updateChoice:${choiceOf(g, 'HALL', 'CELL')}->new-node`,
    ])
  })

  it('walks you into the new room', async () => {
    const g = graph()
    stand(g)
    await useDelve.getState().insertRoomOnChoice(choiceOf(g, 'HALL', 'CELL'))
    expect(useDelve.getState().currentNodeId).toBe('new-node')
    expect(useDelve.getState().trail).toEqual([idOf(g, 'HALL'), 'new-node'])
  })

  it('leaves the graph joined up: HALL -> new -> CELL', async () => {
    const g = graph()
    stand(g)
    await useDelve.getState().insertRoomOnChoice(choiceOf(g, 'HALL', 'CELL'))
    const derived = useDelve.getState().derived!
    const fromHall = (derived.children.get(idOf(g, 'HALL')) ?? []).map((c) => c.to_node_id)
    const fromNew = (derived.children.get('new-node') ?? []).map((c) => c.to_node_id)
    expect(fromHall).toEqual(['new-node'])
    expect(fromNew).toEqual([idOf(g, 'CELL')])
  })

  it('undoes by reconnecting first and deleting second', async () => {
    const g = graph()
    stand(g)
    await useDelve.getState().insertRoomOnChoice(choiceOf(g, 'HALL', 'CELL'))
    calls.length = 0

    const entry = useDelve.getState().undoStack.at(-1)!
    expect(entry.label).toContain('insert')
    await entry.invert()
    // Reconnect before delete, so the link is never missing.
    expect(calls).toEqual([
      `updateChoice:${choiceOf(g, 'HALL', 'CELL')}->${idOf(g, 'CELL')}`,
      'deleteNode:new-node',
    ])
  })

  it('refuses a door that leads nowhere, and writes nothing', async () => {
    const g = makeGraph(['HALL', 'CELL'], ['HALL>CELL', 'HALL>'])
    stand(g)
    const unwired = [...g.choices.values()].find((c) => c.to_node_id === null)!
    const id = await useDelve.getState().insertRoomOnChoice(unwired.id)
    expect(id).toBeNull()
    expect(calls).toEqual([])
    expect(useDelve.getState().error).toMatch(/leads nowhere/i)
  })

  it('writes nothing in the walkthrough story', async () => {
    const g = graph()
    stand(g)
    useDelve.setState({ demo: true })
    const id = await useDelve.getState().insertRoomOnChoice(choiceOf(g, 'HALL', 'CELL'))
    expect(id).toBeNull()
    expect(calls).toEqual([])
  })
})
