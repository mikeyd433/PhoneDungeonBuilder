import { describe, expect, it } from 'vitest'
import { compileStory } from './compile'
import { INV_RETURN, INV_START, invItemCheck, invItemPlay, invRetName } from './inventory'
import { choiceOf, idOf, makeGraph } from '@/test/factory'
import type { InventoryKey, StateVar, StoryGraph } from '@/types/domain'

const STAMP = '2026-01-01T00:00:00Z'
const BASE = 'https://audio.example/'

function item(graph: StoryGraph, slug: string, opts: { recorded?: boolean; name?: string } = {}) {
  const v: StateVar = {
    id: `v-${slug}`,
    story_id: graph.story.id,
    slug,
    name: opts.name ?? slug,
    kind: 'item',
    description: null,
    is_consumable: false,
    audio_path: opts.recorded === false ? null : `takes/${slug}.mp3`,
    audio_duration_ms: null,
    created_at: STAMP,
    updated_at: STAMP,
  }
  graph.stateVars.set(v.id, v)
  return v
}


function withReadback(graph: StoryGraph, key: InventoryKey = '*', opts: { intro?: boolean; empty?: boolean } = {}) {
  graph.story.inventory_key = key
  graph.story.inventory_intro_audio_path = opts.intro === false ? null : 'takes/carrying.mp3'
  graph.story.inventory_empty_audio_path = opts.empty === false ? null : 'takes/nothing.mp3'
  return graph
}

const base = () => makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
const names = (r: ReturnType<typeof compileStory>) => new Set(r.widgets.map((w) => w.name))

describe('inventory readback', () => {
  it('emits nothing at all when the story has no reserved key', () => {
    const r = compileStory(base(), BASE)
    expect([...names(r)].filter((n) => n.startsWith('inv_'))).toEqual([])
  })

  it('emits the chain once, not once per room', () => {
    const g = withReadback(base())
    item(g, 'ROPE')
    const r = compileStory(g, BASE)
    expect(r.widgets.filter((w) => w.name === INV_START)).toHaveLength(1)
    expect(r.widgets.filter((w) => w.name === INV_RETURN)).toHaveLength(1)
    // One note-to-self per room, which is what makes the shared chain possible.
    expect(names(r).has(invRetName('HALL'))).toBe(true)
    expect(names(r).has(invRetName('CAVE'))).toBe(true)
  })

  it('lands every transition on a widget that exists', () => {
    const g = withReadback(base())
    item(g, 'ROPE')
    item(g, 'LANTERN')
    item(g, 'GHOST', { recorded: false })
    const r = compileStory(g, BASE)
    const present = names(r)
    for (const w of r.widgets) {
      for (const t of w.transitions) {
        if (!t.next) continue
        expect(present, `${w.name} -> ${t.next}`).toContain(t.next)
      }
    }
  })

  it('reads items back in one test and one line each', () => {
    const g = withReadback(base())
    item(g, 'ROPE')
    item(g, 'LANTERN')
    const r = compileStory(g, BASE)
    const present = names(r)
    for (const slug of ['LANTERN', 'ROPE']) {
      expect(present).toContain(invItemCheck(slug))
      expect(present).toContain(invItemPlay(slug))
    }
    // Chained alphabetically, ending at the return.
    const lantern = r.widgets.find((w) => w.name === invItemCheck('LANTERN'))!
    expect(lantern.transitions.find((t) => t.event === 'noMatch')?.next).toBe(invItemCheck('ROPE'))
    const rope = r.widgets.find((w) => w.name === invItemCheck('ROPE'))!
    expect(rope.transitions.find((t) => t.event === 'noMatch')?.next).toBe(INV_RETURN)
  })

  it('says nothing for an item nobody recorded, and reports it', () => {
    const g = withReadback(base())
    item(g, 'ROPE')
    item(g, 'GHOST', { recorded: false, name: 'a ghost' })
    const r = compileStory(g, BASE)
    expect(names(r).has(invItemPlay('GHOST'))).toBe(false)
    expect(names(r).has(invItemCheck('GHOST'))).toBe(false)
    expect(r.warnings.some((w) => w.includes('a ghost') && w.includes('no recording'))).toBe(true)
  })

  it('skips the lead-in when it was never recorded', () => {
    const g = withReadback(base(), '*', { intro: false })
    item(g, 'ROPE')
    const r = compileStory(g, BASE)
    const start = r.widgets.find((w) => w.name === INV_START)!
    expect(start.transitions.find((t) => t.event === 'noMatch')?.next).toBe(invItemCheck('ROPE'))
    expect(r.warnings.some((w) => w.includes('lead-in'))).toBe(true)
  })

  it('returns empty hands straight back when there is no take for it', () => {
    const g = withReadback(base(), '*', { empty: false })
    item(g, 'ROPE')
    const r = compileStory(g, BASE)
    const start = r.widgets.find((w) => w.name === INV_START)!
    expect(start.transitions.find((t) => t.event === 'match')?.next).toBe(INV_RETURN)
  })

  /**
   * The one that would be a real bug on the phone: coming back must not re-run
   * the room's arrival effects, or checking your pockets in a room that hands
   * you something hands it to you again, every time.
   */
  it('returns to the room’s replay, never to its arrival effects', () => {
    const g = withReadback(base())
    const rope = item(g, 'ROPE')
    // CAVE grants something on arrival, so it has an `_fx` entry widget.
    g.effects.set('e-arrive', {
      id: 'e-arrive',
      story_id: g.story.id,
      node_id: idOf(g, 'CAVE'),
      choice_id: null,
      state_var_id: rope.id,
      operation: 'grant',
      amount: null,
      sort_order: 0,
      created_at: STAMP,
    })
    const r = compileStory(g, BASE)
    expect(names(r)).toContain('CAVE_fx')

    const back = r.widgets.find((w) => w.name === INV_RETURN)!
    const toCave = back.transitions.find((t) => t.condition === 'equal_to CAVE')!
    expect(toCave.next).not.toBe('CAVE_fx')
  })

  it('refuses to steal a key a room already uses for a door, and says so', () => {
    const g = makeGraph(['HALL', 'CAVE'], ['HALL>CAVE'])
    const id = choiceOf(g, 'HALL', 'CAVE')
    g.choices.set(id, { ...g.choices.get(id)!, digit: '*' })
    withReadback(g, '*')
    item(g, 'ROPE')
    const r = compileStory(g, BASE)

    // HALL keeps its door; it just can't reach the readback.
    expect(names(r).has(invRetName('HALL'))).toBe(false)
    expect(names(r).has(invRetName('CAVE'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('HALL') && w.includes('already uses *'))).toBe(true)

    const gather = r.widgets.find((w) => w.name === 'HALL_gather')!
    const starred = gather.transitions.filter((t) => t.condition === 'Digits equals *')
    expect(starred).toHaveLength(1)
    expect(starred[0].next).not.toBe(invRetName('HALL'))
  })

  it('costs a bounded number of widgets — shared, not copied per room', () => {
    const many = Array.from({ length: 20 }, (_, i) => `R${i}`)
    const g = makeGraph(many, many.slice(1).map((r, i) => `${many[i]}>${r}`))
    withReadback(g)
    item(g, 'ROPE')
    item(g, 'LANTERN')
    const r = compileStory(g, BASE)
    const inv = [...names(r)].filter((n) => n.startsWith('inv_'))
    // 20 notes-to-self + start + none + intro + return + 2 per recorded item.
    expect(inv).toHaveLength(20 + 4 + 4)
  })
})
