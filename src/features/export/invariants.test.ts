import { describe, expect, it } from 'vitest'
import { addFight, addCharacter, addLines, makeGraph, setOutcome } from '@/test/factory'
import { compileStory } from '@/features/export/compile'

/**
 * Invariants that hold for ANY story, however unfinished.
 *
 * Studio refuses a flow whose transition names something that isn't there, so a
 * dangling transition is not a cosmetic problem — it is an export that cannot
 * be imported. Half-built stories are the normal state of this app, so the
 * degenerate cases below are the ones that actually happen: a fight created but
 * not filled in, a room written but not recorded, a scene half-voiced.
 */

/** Every transition must land on a widget that exists. */
function dangling(g: Parameters<typeof compileStory>[0]) {
  const r = compileStory(g, 'https://a/')
  const names = new Set(r.widgets.map((w) => w.name))
  const bad: string[] = []
  for (const w of r.widgets) {
    for (const t of w.transitions) {
      if (t.next && !names.has(t.next)) bad.push(`${w.name} --${t.event}--> ${t.next}`)
    }
  }
  if (r.entryWidget && !names.has(r.entryWidget)) bad.push(`Trigger --> ${r.entryWidget}`)
  return bad
}

describe('no dangling transitions', () => {
  it('fight with no rounds', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [], { recorded: ['A', 'WIN', 'LOSE'] })
    addFight(g, 'A', { moves: ['P beats K'], rounds: [], win: 'WIN', lose: 'LOSE' })
    expect(dangling(g)).toEqual([])
  })
  it('fight with no moves', () => {
    const g = makeGraph(['A', 'WIN', 'LOSE'], [], { recorded: ['A', 'WIN', 'LOSE'] })
    addFight(g, 'A', { moves: [], rounds: ['K'], win: 'WIN', lose: 'LOSE', recorded: true })
    expect(dangling(g)).toEqual([])
  })
  it('fight with nothing set at all', () => {
    const g = makeGraph(['A'], [], { recorded: ['A'] })
    addFight(g, 'A', { moves: [], rounds: [] })
    expect(dangling(g)).toEqual([])
  })
  it('unrecorded everything', () => {
    const g = makeGraph(['A', 'B', 'FIN'], ['A>B', 'B>FIN'], { endings: ['FIN'] })
    expect(dangling(g)).toEqual([])
  })
  it('conversation half recorded', () => {
    const g = makeGraph(['A', 'B'], ['A>B'])
    addCharacter(g, 'C', { name: 'C' })
    addLines(g, 'A', ['C|one', 'C|two'], { recorded: true })
    const [first] = [...g.dialogue.values()]
    g.dialogue.set(first.id, { ...first, audio_path: null })
    expect(dangling(g)).toEqual([])
  })
  it('fight outcome pointing at an unrecorded room', () => {
    const g = makeGraph(['A', 'SIDE', 'LOSE'], [], { recorded: ['A'] })
    addFight(g, 'A', { moves: ['P beats K'], rounds: ['K'], lose: 'LOSE', recorded: true })
    setOutcome(g, 'A', 0, 0, 'SIDE')
    expect(dangling(g)).toEqual([])
  })
})
