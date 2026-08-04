import { describe, expect, it } from 'vitest'
import { compileStory } from './compile'
import { audioTargets, matchFile } from '@/features/audio/targets'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { Effect, Gate, StoryGraph } from '@/types/domain'

const STAMP = '2026-01-01T00:00:00Z'
const BASE = 'https://audio.example/'
const compiled = (g: StoryGraph) => compileStory(g, BASE)
const byName = (g: StoryGraph, name: string) => compiled(g).widgets.find((w) => w.name === name)

function react(g: StoryGraph, from: string, to: string, opts: { recorded?: boolean } = {}) {
  const id = choiceOf(g, from, to)
  g.choices.set(id, {
    ...g.choices.get(id)!,
    reaction_narration: 'The glass goes everywhere.',
    audio_path: opts.recorded === false ? null : 'takes/smash.mp3',
  })
  return id
}

function grantOn(g: StoryGraph, choiceId: string) {
  g.stateVars.set('v1', {
    id: 'v1',
    story_id: g.story.id,
    slug: 'SHARD',
    name: 'a shard of glass',
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
  g.effects.set('e1', {
    id: 'e1',
    story_id: g.story.id,
    node_id: null,
    choice_id: choiceId,
    state_var_id: 'v1',
    operation: 'grant',
    amount: null,
    sort_order: 0,
    created_at: STAMP,
  } as Effect)
}

function gateOn(g: StoryGraph, choiceId: string) {
  g.gates.set('g1', {
    id: 'g1',
    story_id: g.story.id,
    choice_id: choiceId,
    expression: { op: 'has', var: 'SHARD' },
    fail_behavior: 'refuse',
    fail_narration: 'It will not budge.',
    fail_audio_path: 'takes/refuse.mp3',
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: false,
    created_at: STAMP,
    updated_at: STAMP,
  } as unknown as Gate)
}

const base = () => makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'], { recorded: ['HALL', 'CAVE'] })

describe('a door’s reaction', () => {
  it('is not emitted when there is none', () => {
    expect(byName(base(), 'HALL_d1_react')).toBeUndefined()
  })

  it('plays between the keypress and the next room', () => {
    const g = base()
    react(g, 'HALL', 'CAVE')
    const keys = byName(g, 'HALL_keys')!
    const pressed = keys.transitions.find((t) => t.match?.value === '1')!
    expect(pressed.next).toBe('HALL_d1_react')
    expect(byName(g, 'HALL_d1_react')!.transitions[0].next).toBe('CAVE_play')
  })

  it('plays after the effects, so the item is in hand as it is described', () => {
    const g = base()
    const id = react(g, 'HALL', 'CAVE')
    grantOn(g, id)
    const keys = byName(g, 'HALL_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('HALL_d1_fx')
    expect(byName(g, 'HALL_d1_fx')!.transitions[0].next).toBe('HALL_d1_react')
    expect(byName(g, 'HALL_d1_react')!.transitions[0].next).toBe('CAVE_play')
  })

  /**
   * The one that would be wrong on the phone rather than merely untidy: a
   * caller who was refused must not hear the reaction to the thing they were
   * refused. The refusal has its own take.
   */
  it('sits inside the gate, so a refused caller never hears it', () => {
    const g = base()
    const id = react(g, 'HALL', 'CAVE')
    gateOn(g, id)

    const keys = byName(g, 'HALL_keys')!
    expect(keys.transitions.find((t) => t.match?.value === '1')!.next).toBe('HALL_d1_gate')

    const gate = byName(g, 'HALL_d1_gate')!
    expect(gate.transitions.find((t) => t.event === 'match')!.next).toBe('HALL_d1_react')
    // The refusal route goes to the refusal, and never through the reaction.
    expect(gate.transitions.find((t) => t.event === 'noMatch')!.next).toBe('HALL_d1_refuse')
  })

  it('says nothing, and reports it, when written but never recorded', () => {
    const g = base()
    react(g, 'HALL', 'CAVE', { recorded: false })
    const r = compiled(g)
    expect(r.widgets.find((w) => w.name === 'HALL_d1_react')).toBeUndefined()
    expect(r.warnings.some((w) => w.includes('reaction written') && w.includes('HALL'))).toBe(true)
  })

  it('is silent about a door nobody wrote a reaction for', () => {
    const r = compiled(base())
    expect(r.warnings.some((w) => w.includes('reaction'))).toBe(false)
  })

  it('lands on a widget that exists, like everything else', () => {
    const g = base()
    const id = react(g, 'HALL', 'CAVE')
    grantOn(g, id)
    gateOn(g, id)
    const r = compiled(g)
    const present = new Set(r.widgets.map((w) => w.name))
    for (const w of r.widgets) {
      for (const t of w.transitions) {
        if (t.next) expect(present, `${w.name} -> ${t.next}`).toContain(t.next)
      }
    }
  })
})

describe('a reaction as something to record', () => {
  it('is asked for by name once it is written', () => {
    const g = base()
    react(g, 'HALL', 'CAVE', { recorded: false })
    const target = audioTargets(g).find((t) => t.kind === 'reaction')!
    expect(target.file).toBe('HALL__d1__react')
    expect(target.currentPath).toBeNull()
  })

  it('is matched by a file named for it', () => {
    const g = base()
    react(g, 'HALL', 'CAVE', { recorded: false })
    const hit = matchFile(audioTargets(g), 'HALL__d1__react take 2.wav')
    expect(hit?.ref).toEqual({ kind: 'reaction', choiceId: choiceOf(g, 'HALL', 'CAVE') })
  })

  it('is not confused with the refusal on the same digit', () => {
    const g = base()
    const id = react(g, 'HALL', 'CAVE', { recorded: false })
    gateOn(g, id)
    const targets = audioTargets(g)
    expect(matchFile(targets, 'HALL__d1.wav')?.kind).toBe('refusal')
    expect(matchFile(targets, 'HALL__d1__react.wav')?.kind).toBe('reaction')
  })

  it('is not asked for on a door that has no reaction', () => {
    const g = base()
    expect(audioTargets(g).some((t) => t.kind === 'reaction')).toBe(false)
    expect(idOf(g, 'HALL')).toBeTruthy()
  })
})
