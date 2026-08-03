import { describe, expect, it } from 'vitest'
import { auditItems, itemProblems } from './itemAudit'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Effect, Gate, StoryGraph } from '@/types/domain'

const STAMP = '2026-01-01T00:00:00Z'

function withRope(opts: { grant?: boolean; revoke?: boolean; gate?: boolean } = {}) {
  const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
  g.stateVars.set('v1', {
    id: 'v1',
    story_id: g.story.id,
    slug: 'ROPE',
    name: 'A coil of rope',
    kind: 'item',
    description: null,
    is_consumable: false,
    audio_path: null,
    audio_duration_ms: null,
    created_at: STAMP,
    updated_at: STAMP,
  })
  if (opts.grant) {
    g.effects.set('e1', {
      id: 'e1',
      story_id: g.story.id,
      node_id: idOf(g, 'HALL'),
      choice_id: null,
      state_var_id: 'v1',
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: STAMP,
    } as Effect)
  }
  if (opts.revoke) {
    g.effects.set('e2', {
      id: 'e2',
      story_id: g.story.id,
      node_id: idOf(g, 'CAVE'),
      choice_id: null,
      state_var_id: 'v1',
      operation: 'revoke',
      amount: null,
      sort_order: 0,
      created_at: STAMP,
    } as Effect)
  }
  if (opts.gate) {
    g.gates.set('g1', {
      id: 'g1',
      story_id: g.story.id,
      choice_id: choiceOf(g, 'HALL', 'CAVE'),
      expression: { op: 'has', var: 'ROPE' },
      fail_behavior: 'refuse',
      fail_narration: null,
      fail_audio_path: null,
      fail_audio_duration_ms: null,
      fail_node_id: null,
      consume_on_pass: false,
      created_at: STAMP,
      updated_at: STAMP,
    } as unknown as Gate)
  }
  return g
}

const only = (g: StoryGraph) => auditItems(g)[0]

describe('auditing the satchel', () => {
  /**
   * The state this story is actually in: five items handed out, no gate
   * anywhere. The satchel fills up and the dungeon plays identically either
   * way, and nothing ever said so.
   */
  it('calls out an item nothing ever checks for', () => {
    const f = only(withRope({ grant: true }))
    expect(f.verdict).toBe('inert')
    expect(f.message).toContain('carrying it changes nothing')
  })

  /** The worse one, and quieter: a door no caller can ever open. */
  it('calls out a gate asking for something never granted', () => {
    const f = only(withRope({ gate: true }))
    expect(f.verdict).toBe('sealed')
    expect(f.message).toContain('can never be opened')
  })

  it('puts the door nobody can open above the item that merely does nothing', () => {
    const g = withRope({ grant: true })
    // A second item, asked for but never given.
    g.stateVars.set('v2', { ...g.stateVars.get('v1')!, id: 'v2', slug: 'KEY', name: 'A key' })
    g.gates.set('g1', {
      id: 'g1',
      story_id: g.story.id,
      choice_id: choiceOf(g, 'HALL', 'CAVE'),
      expression: { op: 'has', var: 'KEY' },
      fail_behavior: 'refuse',
      consume_on_pass: false,
      created_at: STAMP,
      updated_at: STAMP,
    } as unknown as Gate)

    expect(auditItems(g).map((f) => f.slug)).toEqual(['KEY', 'ROPE'])
  })

  it('says nothing about an item that is granted and checked', () => {
    const f = only(withRope({ grant: true, gate: true }))
    expect(f.verdict).toBe('fine')
    expect(itemProblems(withRope({ grant: true, gate: true }))).toEqual([])
  })

  it('flags something taken away that is never given', () => {
    expect(only(withRope({ revoke: true })).verdict).toBe('sealed')
  })

  it('flags an item nothing touches at all', () => {
    const f = only(withRope())
    expect(f.verdict).toBe('unused')
  })

  /** Gates hold slugs and effects hold ids; counted in different currencies,
   *  every item looks unused. */
  it('matches a gate’s slug to the effect’s id', () => {
    const f = only(withRope({ grant: true, gate: true }))
    expect(f.grants).toBe(1)
    expect(f.checks).toBe(1)
  })

  it('is not case-sensitive about the slug a gate names', () => {
    const g = withRope({ grant: true, gate: true })
    const gate = g.gates.get('g1')!
    g.gates.set('g1', { ...gate, expression: { op: 'has', var: 'rope' } } as Gate)
    expect(only(g).verdict).toBe('fine')
  })

  /** Only when something reads the satchel out loud. */
  it('asks for a take of the name only when there is a readback', () => {
    const g = withRope({ grant: true, gate: true })
    expect(only(g).verdict).toBe('fine')
    g.story = { ...g.story, inventory_key: '*' }
    expect(only(g).verdict).toBe('silent')
  })
})
