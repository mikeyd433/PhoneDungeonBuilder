import { describe, expect, it } from 'vitest'
import { editDistance, nearDuplicates } from './merge'
import { addCharacter, addLines, makeGraph } from '@/test/factory'
import type { StoryGraph } from '@/types/domain'

/**
 * Two cast entries that are one person.
 *
 * The cases here are the real cast of the story this was built for: it came
 * back from the import with Froggem AND Froggum, one line each, and with Shark
 * and Shark King, who are two characters. Getting the second pair wrong would
 * be worse than missing the first — a merge destroys a distinction, and the
 * fix for a missed suggestion is to rename by hand.
 */
/** A cast, with a line count each. Lines all live in one room, added in a
 *  single call because the factory numbers them per room. */
const swamp = (...cast: Array<[name: string, lines: number]>): StoryGraph => {
  const g = makeGraph(['CAVE', 'SWAMP'], ['CAVE>SWAMP'])
  const specs: string[] = []
  cast.forEach(([name, lines], n) => {
    // Numbered, not derived from the name: `Mike` and `mike` are two rows in
    // the story that started this, and a slug built from the name would make
    // them one and quietly delete the case the test is about.
    const slug = `C${n}`
    addCharacter(g, slug, { name })
    for (let i = 0; i < lines; i++) specs.push(`${slug}|${name} says ${i + 1}`)
  })
  addLines(g, 'CAVE', specs)
  return g
}

const pairsOf = (g: StoryGraph) => nearDuplicates(g).map((p) => `${p.keep.name}+${p.drop.name}`)

describe('nearDuplicates', () => {
  it('catches the typo that started this — Froggem and Froggum', () => {
    const g = swamp(['Froggem', 1], ['Froggum', 1])
    expect(pairsOf(g)).toEqual(['Froggem+Froggum'])
  })

  /** The one it must never get wrong: merging these loses a character. */
  it('leaves Shark and Shark King alone', () => {
    const g = swamp(['Shark', 3], ['Shark King', 2])
    expect(pairsOf(g)).toEqual([])
  })

  it('treats case and punctuation as the same name, not a difference', () => {
    const g = swamp(['Tony Hawk', 2], ['tony-hawk', 1])
    const [pair] = nearDuplicates(g)
    expect(pair.certain).toBe(true)
    expect(pair.why).toBe('the same name, typed differently')
  })

  /** Whoever speaks more is the likelier spelling, and the smaller rewrite. */
  it('keeps the one with more lines', () => {
    const g = swamp(['Cartre', 1], ['Carter', 18])
    const [pair] = nearDuplicates(g)
    expect(pair.keep.name).toBe('Carter')
    expect(pair.drop.name).toBe('Cartre')
  })

  /** Three letters is too short to spend a typo on: `Bob` and `Rob` are two
   *  people, and so are `Cat` and `Rat`. */
  it('asks nothing about very short names', () => {
    const g = swamp(['Bob', 2], ['Rob', 2])
    expect(pairsOf(g)).toEqual([])
  })

  /** A long name has more places to slip, so it buys a second typo. */
  it('allows two letters in a long name', () => {
    const g = swamp(['Jacked Vlassic Stork', 2], ['Jacked Vlasic Stork', 1])
    expect(pairsOf(g)).toEqual(['Jacked Vlassic Stork+Jacked Vlasic Stork'])
  })

  it('says nothing about a cast with no near misses', () => {
    const g = swamp(['Mike', 21], ['Carter', 18], ['Narrator', 35], ['Dryad', 3])
    expect(pairsOf(g)).toEqual([])
  })

  /** Surest first, then cheapest to be wrong about. */
  it('puts the certain pairs above the guesses', () => {
    const g = swamp(['Mike', 20], ['mike', 1], ['Froggem', 4], ['Froggum', 4])
    expect(pairsOf(g)).toEqual(['Mike+mike', 'Froggem+Froggum'])
  })
})

describe('editDistance', () => {
  it('counts substitutions, insertions and deletions', () => {
    expect(editDistance('froggem', 'froggum', 2)).toBe(1)
    // A swap is ONE slip of the fingers, not two substitutions.
    expect(editDistance('carter', 'cartre', 2)).toBe(1)
    expect(editDistance('shark', 'sharkking', 9)).toBe(4)
    expect(editDistance('mike', 'mike', 2)).toBe(0)
  })

  /** Bounded: over the limit it says so rather than doing the whole grid. */
  it('gives up once it is past the limit', () => {
    expect(editDistance('narrator', 'dryad', 1)).toBeGreaterThan(1)
  })
})
