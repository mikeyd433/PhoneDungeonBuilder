import { describe, expect, it } from 'vitest'
import { isPlainRoom, roomKinds } from './roomKinds'
import { deriveGraph } from '@/features/graph/derived'
import { addCharacter, addFight, addLines, choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Effect, Gate, StoryGraph } from '@/types/domain'

const STAMP = '2026-01-01T00:00:00Z'

const kindsAt = (graph: StoryGraph, slug: string) =>
  roomKinds(graph, deriveGraph(graph), idOf(graph, slug))

function addVar(graph: StoryGraph, slug: string): string {
  const id = `v-${slug}`
  graph.stateVars.set(id, {
    id,
    story_id: graph.story.id,
    slug,
    name: slug,
    kind: 'item',
    description: null,
    is_consumable: false,
    gain_narration: null,
    gain_audio_path: null,
    gain_audio_duration_ms: null,
    spend_narration: null,
    spend_audio_path: null,
    spend_audio_duration_ms: null,
    audio_path: null,
    audio_duration_ms: null,
    created_at: STAMP,
    updated_at: STAMP,
  })
  return id
}

function addEffect(graph: StoryGraph, owner: { node_id?: string; choice_id?: string }) {
  const id = `e-${graph.effects.size}`
  graph.effects.set(id, {
    id,
    story_id: graph.story.id,
    node_id: owner.node_id ?? null,
    choice_id: owner.choice_id ?? null,
    state_var_id: addVar(graph, `item${graph.effects.size}`),
    operation: 'grant',
    amount: null,
    sort_order: 0,
    created_at: STAMP,
    updated_at: STAMP,
  } as Effect)
}

function addGate(graph: StoryGraph, choiceId: string) {
  graph.gates.set('g1', {
    id: 'g1',
    story_id: graph.story.id,
    choice_id: choiceId,
    expression: { op: 'has', var: 'rope' },
    fail_behavior: 'refuse',
    fail_message: null,
    fail_node_id: null,
    created_at: STAMP,
    updated_at: STAMP,
  } as unknown as Gate)
}

describe('roomKinds', () => {
  it('reports a bare room as plain', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    const k = kindsAt(graph, 'HALL')
    expect(k).toEqual({ dialogue: false, items: false, fight: false })
    expect(isPlainRoom(k)).toBe(true)
  })

  it('sees dialogue once the narration is split into lines', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    addCharacter(graph, 'mike')
    addLines(graph, 'HALL', ['mike|Anyone there?'])
    expect(kindsAt(graph, 'HALL').dialogue).toBe(true)
    // Only in the room that has the lines.
    expect(kindsAt(graph, 'CELL').dialogue).toBe(false)
  })

  it('sees an item granted on arrival', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    addEffect(graph, { node_id: idOf(graph, 'HALL') })
    expect(kindsAt(graph, 'HALL').items).toBe(true)
  })

  it('sees an item granted by taking a door', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    addEffect(graph, { choice_id: choiceOf(graph, 'HALL', 'CELL') })
    expect(kindsAt(graph, 'HALL').items).toBe(true)
    // The effect belongs to the door out of HALL, not to CELL.
    expect(kindsAt(graph, 'CELL').items).toBe(false)
  })

  it('counts a gated door as an item room — the gate is half the story', () => {
    const graph = makeGraph(['HALL', 'CELL'], ['HALL>CELL'])
    addGate(graph, choiceOf(graph, 'HALL', 'CELL'))
    expect(kindsAt(graph, 'HALL').items).toBe(true)
  })

  it('sees a fight', () => {
    const graph = makeGraph(['HALL', 'PIT', 'WIN'], ['HALL>PIT'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'WIN' })
    expect(kindsAt(graph, 'PIT').fight).toBe(true)
    expect(kindsAt(graph, 'HALL').fight).toBe(false)
  })

  it('is not exclusive — a fight can grant something too', () => {
    const graph = makeGraph(['HALL', 'PIT', 'WIN'], ['HALL>PIT'])
    addFight(graph, 'PIT', { moves: ['swim beats bite'], rounds: ['bite'], win: 'WIN' })
    addEffect(graph, { node_id: idOf(graph, 'PIT') })
    const k = kindsAt(graph, 'PIT')
    expect(k.fight && k.items).toBe(true)
    expect(isPlainRoom(k)).toBe(false)
  })
})
