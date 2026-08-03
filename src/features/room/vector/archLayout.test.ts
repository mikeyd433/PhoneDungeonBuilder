import { describe, expect, it } from 'vitest'
import { archBox, archPath, archX, MAX_WALL_ARCHES } from './geometry'
import { BACK } from './geometry'

/**
 * One door is not three doors with two missing.
 *
 * A room with a single way onward should read as one — a tall arch centred on
 * the back wall — rather than a narrow opening adrift in empty stone with two
 * blanks beside it.
 */
describe('arch layout', () => {
  const span = (count: number) => {
    const { w } = archBox(count)
    const first = archX(0, count)
    const last = archX(count - 1, count) + w
    return { first, last, w }
  }

  it('makes fewer doors bigger', () => {
    const widths = [1, 2, 3, 4, 5].map((n) => archBox(n).w)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `${i + 1} doors should be narrower than ${i}`).toBeLessThan(widths[i - 1])
    }
  })

  it('makes fewer doors taller, and stands them all on the same floor', () => {
    const tops = [1, 2, 3, 4, 5].map((n) => archBox(n).top)
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1])
    for (const n of [1, 2, 3, 4, 5]) expect(archBox(n).bottom).toBe(BACK.y1)
  })

  it('centres the row on the back wall, whatever the count', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const { first, last } = span(n)
      const leftGap = first - BACK.x0
      const rightGap = BACK.x1 - last
      expect(Math.abs(leftGap - rightGap), `${n} doors are off-centre`).toBeLessThan(0.001)
    }
  })

  it('keeps every arch inside the back wall', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const { first, last } = span(n)
      expect(first, `${n} doors overhang the left`).toBeGreaterThanOrEqual(BACK.x0)
      expect(last, `${n} doors overhang the right`).toBeLessThanOrEqual(BACK.x1)
    }
  })

  it('never overlaps two arches', () => {
    for (let n = 2; n <= MAX_WALL_ARCHES; n++) {
      const { w } = archBox(n)
      for (let i = 1; i < n; i++) {
        expect(archX(i, n), `${n} doors overlap at ${i}`).toBeGreaterThanOrEqual(
          archX(i - 1, n) + w,
        )
      }
    }
  })

  /** Three is what every existing room already renders as, so it must not move
   *  — a layout change that silently redrew 139 rooms would be a different
   *  feature from the one that was asked for. */
  it('leaves the three-door wall exactly where it was', () => {
    expect(archBox(3)).toEqual({ w: 70, top: 112, bottom: BACK.y1 })
    // The old formula: 3 arches of 70 with 10 between, centred in 60..340.
    expect(archX(0, 3)).toBe(85)
    expect(archX(1, 3)).toBe(165)
    expect(archX(2, 3)).toBe(245)
  })

  it('draws a closed arch that starts and ends on the floor line', () => {
    for (const n of [1, 3, 5]) {
      const d = archPath(0, n)
      expect(d.startsWith(`M ${archX(0, n)} ${BACK.y1}`)).toBe(true)
      expect(d.endsWith('Z')).toBe(true)
    }
  })

  it('treats a count outside the table as the nearest one it knows', () => {
    expect(archBox(0)).toEqual(archBox(1))
    expect(archBox(9)).toEqual(archBox(MAX_WALL_ARCHES))
  })
})
