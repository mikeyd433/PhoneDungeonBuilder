import { describe, expect, it } from 'vitest'
import { doorsByDigit, keyConflicts } from './keys'
import { buildRoomView } from './roomModel'
import { compileStory } from './../export/compile'
import { deriveGraph } from '@/features/graph/derived'
import { idOf, makeGraph } from '@/test/factory'
import type { Choice, StoryGraph } from '@/types/domain'

/**
 * Two doors on one key.
 *
 * `unique (from_node_id, digit)` was dropped in 0019, when a room could read
 * several ways and "press 2" was allowed to be a different door in each. The
 * readings went, so it is a story bug again — but the rows can still exist in a
 * story written under 0019, so it is reported rather than refused, and the
 * exporter has to emit something rather than two transitions Studio would
 * silently reduce to one.
 */

/** Two doors on digit 2. The second is unreachable and everything says so. */
const cell = () => {
  const g = makeGraph(['CELL', 'LOCKER', 'CRAWLSPACE'], ['CELL>LOCKER'], {
    recorded: ['CELL', 'LOCKER', 'CRAWLSPACE'],
  })

  const lid = [...g.choices.values()].find((c) => c.digit === '1')!
  lid.digit = '2'
  lid.label = 'try the lid'
  lid.sort_order = 0

  const hatch: Choice = {
    id: 'c-hatch',
    story_id: g.story.id,
    from_node_id: idOf(g, 'CELL'),
    to_node_id: idOf(g, 'CRAWLSPACE'),
    digit: '2',
    label: 'force the hatch',
    reaction_narration: null,
    audio_path: null,
    audio_duration_ms: null,
    sort_order: 1,
    created_at: '',
    updated_at: '',
  }
  g.choices.set(hatch.id, hatch)
  return { g, lid, hatch }
}

describe('doorsByDigit', () => {
  it('groups them, in sort order', () => {
    const { g, lid, hatch } = cell()
    expect(doorsByDigit(g, idOf(g, 'CELL')).get('2')?.map((d) => d.id)).toEqual([lid.id, hatch.id])
  })
})

describe('keyConflicts', () => {
  it('reports a key carrying two doors', () => {
    const { g, lid, hatch } = cell()
    expect(keyConflicts(g, idOf(g, 'CELL'))).toEqual([
      { digit: '2', choiceIds: [lid.id, hatch.id] },
    ])
  })

  it('says nothing about an ordinary room', () => {
    const g = makeGraph(['CELL', 'HALL'], ['CELL>HALL'])
    expect(keyConflicts(g, idOf(g, 'CELL'))).toEqual([])
  })
})

describe('the room view', () => {
  const view = (g: StoryGraph) => buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!

  /** One wall, showing every door — the author's view and only that. */
  it('draws both doors, and marks the clash', () => {
    const { g } = cell()
    const doors = view(g).exits.filter((e) => e.choiceId)
    expect(doors.map((e) => e.label)).toEqual(['try the lid', 'force the hatch'])
    expect(doors.every((e) => e.keyClash)).toBe(true)
  })

  it('puts the blank arch on the first key no door uses', () => {
    const { g } = cell()
    expect(view(g).exits.find((e) => !e.choiceId)?.digit).toBe('1')
  })
})

describe('the export', () => {
  const compiled = (g: StoryGraph) => compileStory(g, 'https://audio.example/')

  /** Two `Digits equals 2` transitions off one split and Studio takes the
   *  first without saying so. One transition, and a warning. */
  it('emits ONE transition for the key, and warns', () => {
    const { g } = cell()
    const out = compiled(g)
    const split = out.widgets.find((w) => w.name === 'CELL_keys')!
    const twos = split.transitions.filter((t) => t.match?.value === '2')
    expect(twos).toHaveLength(1)
    expect(out.warnings.some((w) => w.includes('2 doors on digit 2'))).toBe(true)
  })

  /** Error 81022's second cause. The unreachable door still emits widgets, and
   *  they must not collide with the reachable one's. */
  it('names the second door’s widgets apart', () => {
    const { g, hatch } = cell()
    hatch.reaction_narration = 'The hinge gives.'
    hatch.audio_path = 'takes/hinge.mp3'
    const names = compiled(g).widgets.map((w) => w.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.some((n) => n.includes('_d2b_'))).toBe(true)
  })
})
