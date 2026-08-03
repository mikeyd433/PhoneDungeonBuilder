import { describe, expect, it } from 'vitest'
import { allReadings, playbackWithState, readingFor, variantProblems, variantsOf } from './variants'
import { buildRoomView } from './roomModel'
import { deriveGraph } from '@/features/graph/derived'
import { addReading, addVar, idOf, makeGraph } from '@/test/factory'
import { buildVarIndex, emptyState, type CallerState } from '@/features/state/expression'
import type { StoryGraph } from '@/types/domain'

/** A cell you can talk your way out of only if you picked something up. */
const cell = () => {
  const g = makeGraph(['CELL', 'CORRIDOR'], ['CELL>CORRIDOR'])
  addVar(g, 'LAMP')
  addVar(g, 'CROWBAR')
  g.nodes.get(idOf(g, 'CELL'))!.narration = 'It is too dark to see anything.'
  return g
}

const index = (g: StoryGraph) =>
  buildVarIndex(
    [...g.stateVars.values()].map((v) => ({ slug: v.slug, kind: v.kind })),
    g.story.counter_clamp,
  )

const holding = (g: StoryGraph, ...slugs: string[]): CallerState => {
  const i = index(g)
  let mask = 0
  for (const slug of slugs) mask |= 1 << i.bit.get(slug)!
  return { ...emptyState(i), mask }
}

describe('which reading a caller gets', () => {
  it('is the room’s own when there are no alternates', () => {
    const g = cell()
    expect(readingFor(g, idOf(g, 'CELL'), emptyState(index(g)), index(g))).toBeNull()
  })

  it('is the room’s own when no condition matches', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    expect(readingFor(g, idOf(g, 'CELL'), emptyState(index(g)), index(g))).toBeNull()
  })

  it('is the alternate when its condition holds', () => {
    const g = cell()
    const lit = addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'The lamp shows a door.' })
    expect(readingFor(g, idOf(g, 'CELL'), holding(g, 'LAMP'), index(g))?.id).toBe(lit.id)
  })

  /** The whole reason order is editable: it is an if/elsif, not a set. */
  it('is the FIRST match, not the best one', () => {
    const g = cell()
    const first = addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' })
    expect(readingFor(g, idOf(g, 'CELL'), holding(g, 'LAMP', 'CROWBAR'), index(g))?.id).toBe(first.id)
  })

  it('follows sort_order, not insertion order', () => {
    const g = cell()
    const a = addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { sort_order: 5 })
    const b = addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' }, { sort_order: 1 })
    expect(variantsOf(g, idOf(g, 'CELL')).map((v) => v.id)).toEqual([b.id, a.id])
  })

  /**
   * "Two different items can be used" is an `or`, and it is the shape this
   * whole feature exists to make writable.
   */
  it('takes either item when the condition says any', () => {
    const g = cell()
    const armed = addReading(g, 'CELL', {
      op: 'or',
      args: [
        { op: 'has', var: 'LAMP' },
        { op: 'has', var: 'CROWBAR' },
      ],
    })
    const at = idOf(g, 'CELL')
    expect(readingFor(g, at, holding(g, 'LAMP'), index(g))?.id).toBe(armed.id)
    expect(readingFor(g, at, holding(g, 'CROWBAR'), index(g))?.id).toBe(armed.id)
    expect(readingFor(g, at, emptyState(index(g)), index(g))).toBeNull()
  })
})

describe('what plays', () => {
  it('is the room’s own narration with no alternate in play', () => {
    const g = cell()
    const parts = playbackWithState(g, idOf(g, 'CELL'), emptyState(index(g)), index(g))
    expect(parts.map((p) => p.say)).toEqual(['It is too dark to see anything.'])
  })

  /** REPLACES, not appends. Hearing both versions would be the bug. */
  it('is the alternate ALONE when one applies', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'The lamp shows a door.' })
    const parts = playbackWithState(g, idOf(g, 'CELL'), holding(g, 'LAMP'), index(g))
    expect(parts.map((p) => p.say)).toEqual(['The lamp shows a door.'])
  })

  it('is one part, even where the room splits into lines', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: 'MIKE: over here.\nCARTER: coming.' })
    expect(playbackWithState(g, idOf(g, 'CELL'), holding(g, 'LAMP'), index(g))).toHaveLength(1)
  })
})

describe('the torch', () => {
  const lit = (g: StoryGraph) => buildRoomView(g, deriveGraph(g), idOf(g, 'CELL'))!.torchLit

  it('stays dark while an alternate has no take', () => {
    const g = cell()
    g.nodes.get(idOf(g, 'CELL'))!.audio_path = 'cell.wav'
    expect(lit(g)).toBe(true)
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    expect(lit(g)).toBe(false)
  })

  it('lights when every reading has one', () => {
    const g = cell()
    g.nodes.get(idOf(g, 'CELL'))!.audio_path = 'cell.wav'
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { audio_path: 'cell-alt1.wav' })
    expect(lit(g)).toBe(true)
  })

  it('counts every reading as something to record', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    addReading(g, 'CELL', { op: 'has', var: 'CROWBAR' })
    expect(allReadings(g, idOf(g, 'CELL'))).toHaveLength(3)
  })
})

describe('what the author is warned about', () => {
  /** An empty `and` is true, so it answers for every case below it. */
  it('says when a reading with no condition buries the ones under it', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'and', args: [] })
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    expect(variantProblems(g, idOf(g, 'CELL')).join(' ')).toContain('nothing below it ever will')
  })

  it('does not complain about an unconditional reading at the end', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' })
    addReading(g, 'CELL', { op: 'and', args: [] })
    expect(variantProblems(g, idOf(g, 'CELL')).join(' ')).not.toContain('nothing below it')
  })

  it('says when an "any" with nothing in it can never play', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'or', args: [] })
    expect(variantProblems(g, idOf(g, 'CELL')).join(' ')).toContain('can never play')
  })

  it('says when a reading has no words', () => {
    const g = cell()
    addReading(g, 'CELL', { op: 'has', var: 'LAMP' }, { narration: '  ' })
    expect(variantProblems(g, idOf(g, 'CELL')).join(' ')).toContain('no words')
  })
})
