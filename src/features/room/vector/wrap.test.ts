import { describe, expect, it } from 'vitest'
import { wrapToPlate } from './geometry'

/** The failure this guards against is silent: SVG text does not wrap or clip,
 *  it just keeps drawing out over the wall and into the next arch's plate. */
describe('wrapToPlate', () => {
  const within = (lines: string[], max: number) =>
    lines.every((l) => l.length <= max) && lines.length > 0

  it('leaves something that already fits alone', () => {
    expect(wrapToPlate('THE PIT', 12, 2)).toEqual(['THE PIT'])
  })

  it('breaks a long name at a space', () => {
    expect(wrapToPlate('THE LISTING DECK', 12, 2)).toEqual(['THE LISTING', 'DECK'])
  })

  it('never exceeds the line budget', () => {
    const names = [
      'THE FLOODED HOLD',
      'SHIPWRECK_INTERIOR_LOWER',
      'a',
      'THE ROOM WITH THE VERY LONG NAME INDEED',
      'CARTER_INTRO',
    ]
    for (const n of names) expect(within(wrapToPlate(n, 12, 2), 12)).toBe(true)
  })

  it('marks truncation so a cut name never reads as a whole one', () => {
    const lines = wrapToPlate('THE ROOM WITH THE VERY LONG NAME INDEED', 12, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('cuts a single unbreakable word mid-word', () => {
    const lines = wrapToPlate('SHIPWRECK_INTERIOR_LOWER', 12, 2)
    expect(lines[0]).toBe('SHIPWRECK_I…')
  })

  it('respects a one-line budget', () => {
    expect(wrapToPlate('go up on deck and look around', 17, 1)).toHaveLength(1)
  })

  it('collapses whitespace rather than emitting empty lines', () => {
    expect(wrapToPlate('  THE   PIT  ', 12, 2)).toEqual(['THE PIT'])
  })

  it('returns nothing for nothing', () => {
    expect(wrapToPlate('   ', 12, 2)).toEqual([])
  })
})
