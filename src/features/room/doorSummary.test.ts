import { describe, expect, it } from 'vitest'
import { effectsSummary, leadsSummary, offeredSummary } from './doorSummary'
import { addVar, choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Effect, Gate, StoryGraph } from '@/types/domain'

/**
 * The door sheet's two headline rows, which for a while said the same words on
 * every door in the story — "Ashore · tap to fork it on an item" on a door that
 * already forked, "Always, in some states, or on a condition" on a door hidden
 * everywhere. These tests are the rule that they answer the question instead.
 */

const STAMP = '2024-01-01T00:00:00.000Z'

const ship = () => {
  const g = makeGraph(['HOLD', 'DECK', 'DOWN', 'SHORE'], ['HOLD>DECK', 'HOLD>SHORE'])
  addVar(g, 'ROPE', { name: 'a coil of rope' })
  return g
}

const fork = (g: StoryGraph, choiceId: string, failSlug: string) => {
  const gate: Gate = {
    id: `g-${choiceId}`,
    story_id: g.story.id,
    choice_id: choiceId,
    expression: { op: 'has', var: 'ROPE' },
    fail_behavior: 'divert',
    fail_narration: null,
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: idOf(g, failSlug),
    consume_on_pass: false,
    created_at: STAMP,
    updated_at: STAMP,
  }
  g.gates.set(gate.id, gate)
  return gate
}

describe('leadsSummary', () => {
  it('names the one room an ordinary door leads to', () => {
    const g = ship()
    const s = leadsSummary(g, choiceOf(g, 'HOLD', 'DECK'))
    expect(s.forks).toBe(false)
    expect(s.text).toBe('DECK')
    expect(s.hint).toMatch(/fork it on an item/)
  })

  it('names BOTH rooms of a fork, and which one the condition picks', () => {
    const g = ship()
    const door = choiceOf(g, 'HOLD', 'DECK')
    fork(g, door, 'DOWN')
    const s = leadsSummary(g, door)
    expect(s.forks).toBe(true)
    expect(s.text).toBe('DECK, or DOWN')
    // The names alone do not say which is which — that was the whole failing.
    expect(s.hint).toBe(
      'Forks: DECK when carrying a coil of rope. Tap to change either route.',
    )
  })

  it('says so when a fork has no second room yet', () => {
    const g = ship()
    const door = choiceOf(g, 'HOLD', 'DECK')
    const gate = fork(g, door, 'DOWN')
    gate.fail_node_id = null
    expect(leadsSummary(g, door).text).toBe('DECK, or — nowhere yet —')
  })
})

describe('offeredSummary', () => {
  it('is "Always" for a door with no rules', () => {
    const g = ship()
    expect(offeredSummary(g, choiceOf(g, 'HOLD', 'DECK'))).toEqual({
      text: 'Always',
      never: false,
    })
  })

  it('reads a hide gate as the condition it is', () => {
    const g = ship()
    const door = choiceOf(g, 'HOLD', 'DECK')
    const gate = fork(g, door, 'DOWN')
    gate.fail_behavior = 'hide'
    gate.fail_node_id = null
    expect(offeredSummary(g, door).text).toBe('Only when carrying a coil of rope')
  })

})

describe('effectsSummary', () => {
  const effect = (g: StoryGraph, choiceId: string, op: Effect['operation'], slug: string) => {
    const e: Effect = {
      id: `e-${choiceId}-${slug}-${op}`,
      story_id: g.story.id,
      node_id: null,
      choice_id: choiceId,
      state_var_id: `var-${slug}`,
      operation: op,
      amount: null,
      sort_order: 0,
      created_at: STAMP,
    }
    g.effects.set(e.id, e)
  }

  it('is null for a door that hands nothing over, so the row is not drawn', () => {
    const g = ship()
    expect(effectsSummary(g, choiceOf(g, 'HOLD', 'DECK'))).toBeNull()
  })

  it('names what is given and what is taken', () => {
    const g = ship()
    addVar(g, 'KNIFE', { name: 'the knife' })
    const door = choiceOf(g, 'HOLD', 'DECK')
    effect(g, door, 'grant', 'ROPE')
    effect(g, door, 'revoke', 'KNIFE')
    expect(effectsSummary(g, door)).toBe('+a coil of rope −the knife')
  })
})
