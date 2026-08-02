import { describe, expect, it } from 'vitest'
import { describeCollapse, planCollapse } from './collapse'
import { deriveGraph } from '@/features/graph/derived'
import { addFight, choiceOf, idOf, makeGraph, setOutcome } from '@/test/factory'
import type { Gate, StoryGraph } from '@/types/domain'

const plan = (graph: StoryGraph, slug: string) =>
  planCollapse(graph, deriveGraph(graph), idOf(graph, slug))

/** makeGraph roots the story at the first slug; most cases want a spare above. */
const chain = () => makeGraph(['HALL', 'DOOR', 'CELL'], ['HALL>DOOR', 'DOOR>CELL'])

describe('planCollapse', () => {
  it('joins the rooms either side', () => {
    const graph = chain()
    const c = plan(graph, 'DOOR')
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.plan.toNodeId).toBe(idOf(graph, 'CELL'))
    expect(c.plan.inbound).toEqual([
      {
        kind: 'choice',
        choiceId: choiceOf(graph, 'HALL', 'DOOR'),
        fromNodeId: idOf(graph, 'HALL'),
        // The factory labels its doors, so there is nothing to fill in here.
        fillLabel: null,
      },
    ])
  })

  it('moves an unlabelled door’s words onto the door', () => {
    const graph = chain()
    graph.nodes.set(idOf(graph, 'DOOR'), {
      ...graph.nodes.get(idOf(graph, 'DOOR'))!,
      title: 'enter door',
    })
    // An import that had no label for the door is the case that matters: the
    // caller heard "enter door" only because the room read itself out.
    const inbound = choiceOf(graph, 'HALL', 'DOOR')
    graph.choices.set(inbound, { ...graph.choices.get(inbound)!, label: '   ' })
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.labelsFilled).toBe(1)
    expect(c.ok && c.plan.inbound[0]).toMatchObject({ fillLabel: 'enter door' })
  })

  it('leaves a door that already has a label alone', () => {
    const graph = chain()
    const id = choiceOf(graph, 'HALL', 'DOOR')
    graph.choices.set(id, { ...graph.choices.get(id)!, label: 'Push it open' })
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.labelsFilled).toBe(0)
    expect(c.ok && c.plan.inbound[0]).toMatchObject({ fillLabel: null })
  })

  it('treats several doors to the same room as one way onward', () => {
    const graph = makeGraph(['HALL', 'DOOR', 'CELL'], ['HALL>DOOR', 'DOOR>CELL', 'DOOR>CELL'])
    const c = plan(graph, 'DOOR')
    expect(c.ok).toBe(true)
    expect(c.ok && c.plan.droppedExits).toBe(1)
  })

  it('counts unwritten branches that go with the room', () => {
    const graph = makeGraph(['HALL', 'DOOR', 'CELL'], ['HALL>DOOR', 'DOOR>CELL', 'DOOR>'])
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.droppedBricked).toBe(1)
  })

  it('carries a fight’s win room across', () => {
    const graph = makeGraph(['HALL', 'PIT', 'DOOR', 'CELL'], ['HALL>PIT', 'DOOR>CELL'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'DOOR' })
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.inbound).toEqual([{ kind: 'fight-win', fightId: 'f-PIT' }])
  })

  it('carries a round’s named outcome across', () => {
    const graph = makeGraph(['HALL', 'PIT', 'DOOR', 'CELL'], ['HALL>PIT', 'DOOR>CELL'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'HALL' })
    setOutcome(graph, 'PIT', 0, 0, 'DOOR')
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.inbound).toEqual([
      { kind: 'fight-move', roundId: 'f-PIT-r0', moveId: 'f-PIT-m0' },
    ])
  })

  it('carries silence and wrong-key redirects across', () => {
    const graph = chain()
    const hall = idOf(graph, 'HALL')
    graph.nodes.set(hall, {
      ...graph.nodes.get(hall)!,
      timeout_target_id: idOf(graph, 'DOOR'),
      invalid_target_id: idOf(graph, 'DOOR'),
    })
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.redirects).toEqual([
      { nodeId: hall, field: 'timeout_target_id' },
      { nodeId: hall, field: 'invalid_target_id' },
    ])
  })

  it('collapses an orphan, and says so', () => {
    const graph = makeGraph(['HALL', 'DOOR', 'CELL'], ['DOOR>CELL'])
    const c = plan(graph, 'DOOR')
    expect(c.ok && c.plan.orphan).toBe(true)
    expect(c.ok && describeCollapse(c.plan, 'DOOR')).toContain('Nothing leads here')
  })

  describe('refuses when it would break something', () => {
    const refuses = (graph: StoryGraph, slug: string, match: RegExp) => {
      const c = plan(graph, slug)
      expect(c.ok).toBe(false)
      if (!c.ok) expect(c.reason).toMatch(match)
    }

    it('the entrance', () => {
      const graph = chain()
      graph.story.root_node_id = idOf(graph, 'HALL')
      refuses(graph, 'HALL', /entrance/i)
    })

    it('a room with no way onward', () => {
      const graph = makeGraph(['HALL', 'DOOR'], ['HALL>DOOR'])
      refuses(graph, 'DOOR', /no way onward/i)
    })

    it('a fork', () => {
      const graph = makeGraph(['HALL', 'DOOR', 'A', 'B'], ['HALL>DOOR', 'DOOR>A', 'DOOR>B'])
      refuses(graph, 'DOOR', /2 different rooms/)
    })

    it('an ending', () => {
      const graph = makeGraph(['HALL', 'DOOR', 'CELL'], ['HALL>DOOR', 'DOOR>CELL'], {
        endings: ['DOOR'],
      })
      refuses(graph, 'DOOR', /ending/i)
    })

    it('a fight room', () => {
      const graph = makeGraph(['HALL', 'DOOR', 'CELL'], ['HALL>DOOR', 'DOOR>CELL'])
      addFight(graph, 'DOOR', { moves: ['swim beats bite'], rounds: ['bite'], win: 'CELL' })
      refuses(graph, 'DOOR', /fight/i)
    })

    it('a room that loops to itself', () => {
      const graph = makeGraph(['HALL', 'DOOR'], ['HALL>DOOR', 'DOOR>DOOR'])
      refuses(graph, 'DOOR', /itself/i)
    })

    it('a room whose door is gated', () => {
      const graph = chain()
      graph.gates.set('g1', {
        id: 'g1',
        story_id: graph.story.id,
        choice_id: choiceOf(graph, 'DOOR', 'CELL'),
        expression: { op: 'has', var: 'rope' },
        fail_behavior: 'refuse',
        fail_message: null,
        fail_node_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      } as unknown as Gate)
      refuses(graph, 'DOOR', /gated/i)
    })
  })
})
