import { describe, expect, it } from 'vitest'
import {
  ARCH_BAND,
  MAX_DRAWN,
  MAX_NAME,
  placements,
  spanOf,
  tagBox,
  TAG_BASELINE,
} from './figureLayout'
import { VIEW } from './geometry'
import { FIGURES, type FigureKind } from '@/types/domain'

/**
 * A figure never covers a door.
 *
 * This is the whole reason the layout is a separate pure module. Figures used
 * to be spread across the middle of the floor with the name over the head: one
 * figure landed dead centre, on the middle archway, with its plate across the
 * opening — and with "show where doors lead" on, its body covered the
 * destination too. The rule is asserted here rather than looked at, because
 * "looked at" is how it shipped.
 */

describe('placements', () => {
  it('keeps every silhouette out of the archways', () => {
    for (const left of FIGURES) {
      for (const right of FIGURES) {
        const [a, b] = placements([left, right])
        expect(spanOf(left, a).x1, `${left} on the left`).toBeLessThan(ARCH_BAND.x0)
        expect(spanOf(right, b).x0, `${right} on the right`).toBeGreaterThan(ARCH_BAND.x1)
      }
    }
  })

  /** The head is the whole thing that says what a silhouette IS, and the beast
   *  wears its head at the wide end. Facing outward, the frame cut it off. */
  it('turns an asymmetric silhouette to face into the room', () => {
    const [left] = placements(['beast'])
    const [, right] = placements(['standing', 'beast'])
    expect(left.flip, 'the beast in the left wing').toBe(true)
    expect(right.flip, 'the beast in the right wing').toBe(false)
    expect(placements(['standing'])[0].flip, 'a symmetric one has no reason to').toBe(false)
  })

  it('stands one in each wing', () => {
    const [a, b] = placements(['standing', 'standing'])
    expect(a.side).toBe('left')
    expect(b.side).toBe('right')
    expect(a.x).toBeLessThan(VIEW.w / 2)
    expect(b.x).toBeGreaterThan(VIEW.w / 2)
  })

  /** Two wings, two people. A third would have to stand in the arch band. */
  it('draws no more than the wings can hold', () => {
    expect(placements(['standing', 'small', 'beast', 'seated'])).toHaveLength(MAX_DRAWN)
    expect(placements(['standing'])).toHaveLength(1)
    expect(placements([])).toHaveLength(0)
  })

  /** A body cropped by the frame reads as standing near the wall; a body over
   *  a door hides the door. Only the wide kinds should ever be cropped. */
  it('crops at the frame rather than reaching into a door', () => {
    for (const kind of FIGURES) {
      const [spot] = placements([kind])
      expect(spanOf(kind, spot).x1, kind).toBeLessThan(ARCH_BAND.x0)
    }
  })
})

describe('the name plate', () => {
  it('stays on the canvas however long the name', () => {
    for (const kinds of [['standing'], ['beast']] as FigureKind[][]) {
      const [spot] = placements(kinds)
      for (const chars of [1, 8, MAX_NAME]) {
        const box = tagBox(spot, chars)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w).toBeLessThanOrEqual(VIEW.w)
      }
    }
  })

  /** Two full-length names, one per wing, must not meet in the middle — that
   *  is what caps the drawn name rather than the name being long. */
  it('leaves the middle clear for the two longest names', () => {
    const [a, b] = placements(['standing', 'standing'])
    const left = tagBox(a, MAX_NAME)
    const right = tagBox(b, MAX_NAME)
    expect(left.x + left.w).toBeLessThan(right.x)
  })

  /** Under the feet, under the plates the wall hangs, above the bottom edge. */
  it('sits below everything the wall hangs', () => {
    expect(TAG_BASELINE).toBeGreaterThan(VIEW.h - 20)
    expect(TAG_BASELINE).toBeLessThanOrEqual(VIEW.h - 3)
  })
})
