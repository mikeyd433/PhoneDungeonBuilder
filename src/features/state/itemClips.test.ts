import { describe, expect, it } from 'vitest'
import { clipFor, clipsFor, movesOf } from './itemClips'
import { compileStory } from '@/features/export/compile'
import { PlaytestEngine } from '@/features/playtest/engine'
import { addVar, choiceOf, idOf, makeGraph, words } from '@/test/factory'
import type { Effect, Gate, StateVar, StoryGraph } from '@/types/domain'

/**
 * What an item says as it changes hands.
 *
 * The rule that matters most here is the one at the bottom: the exported flow
 * and the rehearsal have to put these in the same place. A clip the playtest
 * plays and the phone does not is worse than no clip at all — it rehearses a
 * scene nobody will hear.
 */

const STAMP = '2024-01-01T00:00:00.000Z'

const effect = (
  g: StoryGraph,
  on: { node_id?: string; choice_id?: string },
  operation: Effect['operation'],
  varId: string,
) => {
  const e: Effect = {
    id: `e-${varId}-${operation}-${on.node_id ?? on.choice_id}`,
    story_id: g.story.id,
    node_id: on.node_id ?? null,
    choice_id: on.choice_id ?? null,
    state_var_id: varId,
    operation,
    amount: null,
    sort_order: 0,
    created_at: STAMP,
  }
  g.effects.set(e.id, e)
  return e
}

/** A rope that says something both ways. */
const rope = (g: StoryGraph): StateVar =>
  addVar(g, 'ROPE', {
    name: 'a coil of rope',
    is_consumable: true,
    gain_narration: 'The rope is heavier than it looked.',
    gain_audio_path: 'takes/rope-got.wav',
    spend_narration: 'The last of it.',
    spend_audio_path: 'takes/rope-gone.wav',
  })

describe('clipFor', () => {
  it('is null for an item that says nothing', () => {
    const g = makeGraph(['A'], [])
    expect(clipFor(addVar(g, 'KEY'), 'gain')).toBeNull()
  })

  /** Written but unrecorded is still a clip: the export needs to know it is
   *  there so it can report the silence rather than skip it quietly. */
  it('exists once it is written, take or no take', () => {
    const g = makeGraph(['A'], [])
    const v = addVar(g, 'KEY', { gain_narration: 'Cold.' })
    expect(clipFor(v, 'gain')).toEqual({
      id: `${v.id}:gain`,
      audioPath: null,
      say: 'Cold.',
      speaker: null,
    })
    expect(clipFor(v, 'spend')).toBeNull()
  })
})

describe('movesOf', () => {
  it('reads grant and add as picking up, revoke as using up', () => {
    const g = makeGraph(['A'], [])
    const v = rope(g)
    const moves = (op: Effect['operation']) =>
      movesOf(g, [{ operation: op, state_var_id: v.id }]).map(([, m]) => m)
    expect(moves('grant')).toEqual(['gain'])
    expect(moves('add')).toEqual(['gain'])
    expect(moves('revoke')).toEqual(['spend'])
  })

  /** Being told you now have three of something is bookkeeping, not a moment.
   *  A story that said "you found a rope" on a counter reset would be lying. */
  it('says nothing about a counter being set', () => {
    const g = makeGraph(['A'], [])
    const v = rope(g)
    expect(movesOf(g, [{ operation: 'set', state_var_id: v.id }])).toEqual([])
  })

  it('counts one item moved twice as one moment', () => {
    const g = makeGraph(['A'], [])
    const v = rope(g)
    const twice = [
      { operation: 'grant' as const, state_var_id: v.id },
      { operation: 'grant' as const, state_var_id: v.id },
    ]
    expect(clipsFor(g, twice)).toHaveLength(1)
  })

  /** The exporter knows the item by id and the playtest by slug. Both have to
   *  get the same answer, which is why one function takes either. */
  it('finds the item by id or by slug', () => {
    const g = makeGraph(['A'], [])
    const v = rope(g)
    expect(clipsFor(g, [{ operation: 'grant', state_var_id: v.id }])).toEqual(
      clipsFor(g, [{ operation: 'grant', varSlug: 'ROPE' }]),
    )
  })
})

/** A door that grants the rope, and a locked one that spends it. */
const ship = () => {
  const g = makeGraph(['HOLD', 'DECK', 'VAULT'], ['HOLD>DECK', 'HOLD>VAULT'], {
    recorded: ['HOLD', 'DECK', 'VAULT'],
  })
  // Rooms need words as well as takes: `words()` reads the script, and a room
  // recorded but unwritten has nothing for an ordering assertion to hold on to.
  for (const [slug, text] of [['HOLD', 'The hold.'], ['DECK', 'The deck.'], ['VAULT', 'The vault.']]) {
    const n = g.nodes.get(idOf(g, slug))!
    g.nodes.set(n.id, { ...n, narration: text })
  }
  const v = rope(g)
  effect(g, { choice_id: choiceOf(g, 'HOLD', 'DECK') }, 'grant', v.id)

  const gate: Gate = {
    id: 'g1',
    story_id: g.story.id,
    choice_id: choiceOf(g, 'HOLD', 'VAULT'),
    expression: { op: 'has', var: 'ROPE' },
    fail_behavior: 'refuse',
    fail_narration: null,
    fail_audio_path: null,
    fail_audio_duration_ms: null,
    fail_node_id: null,
    consume_on_pass: true,
    created_at: STAMP,
    updated_at: STAMP,
  }
  g.gates.set(gate.id, gate)
  return { g, item: v }
}

describe('the exported flow', () => {
  const compiled = (g: StoryGraph) => compileStory(g, 'https://audio.example/')

  it('plays the pick-up clip after the effect that grants it', () => {
    const { g } = ship()
    const out = compiled(g)
    const clip = out.widgets.find((w) => w.name === 'HOLD_d1_item')
    expect(clip?.playUrl).toBe('https://audio.example/takes/rope-got.wav')
    // After the effects widget, so the caller has the thing before it is
    // described — and before the room it leads into.
    expect(out.widgets.find((w) => w.name === 'HOLD_d1_fx')?.transitions[0].next).toBe('HOLD_d1_item')
    expect(clip?.transitions[0].next).toBe('DECK_play')
  })

  it('plays the used-up clip after the gate spends it', () => {
    const { g } = ship()
    const out = compiled(g)
    const clip = out.widgets.find((w) => w.name === 'HOLD_d2_spent')
    expect(clip?.playUrl).toBe('https://audio.example/takes/rope-gone.wav')
    expect(out.widgets.find((w) => w.name === 'HOLD_d2_spend')?.transitions[0].next).toBe(
      'HOLD_d2_spent',
    )
  })

  it('plays a pick-up on arrival, before the room reads itself out', () => {
    const g = makeGraph(['HALL', 'ON'], ['HALL>ON'], { recorded: ['HALL', 'ON'] })
    const v = rope(g)
    effect(g, { node_id: idOf(g, 'HALL') }, 'grant', v.id)
    const out = compiled(g)
    expect(out.widgets.find((w) => w.name === 'HALL_fx')?.transitions[0].next).toBe('HALL_item')
    expect(out.widgets.find((w) => w.name === 'HALL_item')?.transitions[0].next).toBe('HALL_play')
  })

  /** Nothing is ever spoken by Twilio, so an unrecorded clip is silence and
   *  has to be reported rather than quietly dropped. */
  it('warns rather than emitting a clip nobody recorded', () => {
    const { g, item } = ship()
    g.stateVars.set(item.id, { ...item, gain_audio_path: null })
    const out = compiled(g)
    expect(out.widgets.some((w) => w.name === 'HOLD_d1_item')).toBe(false)
    expect(out.warnings.some((w) => w.includes('heavier than it looked'))).toBe(true)
  })

  it('costs nothing for an item that says nothing', () => {
    const plain = makeGraph(['HOLD', 'DECK'], ['HOLD>DECK'], { recorded: ['HOLD', 'DECK'] })
    const v = addVar(plain, 'ROPE')
    effect(plain, { choice_id: choiceOf(plain, 'HOLD', 'DECK') }, 'grant', v.id)
    expect(compiled(plain).widgets.some((w) => w.name.includes('_item'))).toBe(false)
  })
})

describe('the rehearsal', () => {
  /** Principle: what the playtest plays and what the phone plays are the same
   *  list. A clip in one and not the other rehearses the wrong story. */
  it('hears the pick-up between the door and the room', () => {
    const { g } = ship()
    const e = new PlaytestEngine(g)
    const said = words(e.press(e.start(), '1').heard)
    expect(said).toContain('The rope is heavier than it looked.')
    expect(said.indexOf('heavier')).toBeLessThan(said.indexOf('The deck.'))
  })

  it('hears the used-up clip when a gate spends it', () => {
    const { g } = ship()
    const e = new PlaytestEngine(g)
    // Pick the rope up first, then spend it on the locked door.
    const carrying = e.press(e.start(), '1').next
    const back = { ...carrying, nodeId: idOf(g, 'HOLD') }
    expect(words(e.press(back, '2').heard)).toContain('The last of it.')
  })

  it('hears a pick-up on arrival', () => {
    const g = makeGraph(['HALL', 'ON'], ['HALL>ON'], { recorded: ['HALL', 'ON'] })
    const v = rope(g)
    effect(g, { node_id: idOf(g, 'ON') }, 'grant', v.id)
    const e = new PlaytestEngine(g)
    expect(words(e.press(e.start(), '1').heard)).toContain('The rope is heavier than it looked.')
  })
})
