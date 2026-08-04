import type { FigureKind } from '@/types/domain'
import { BACK, VIEW } from './geometry'

/**
 * Where somebody standing in the room can stand.
 *
 * They used to be spread across the middle of the floor with a name plate above
 * the head, which put them exactly where the wall keeps the two things that
 * have to stay readable: the archways, and the plates hanging under them. One
 * figure was centred at half the width — dead on the middle arch — and its tag
 * sat at the wall base, over the opening. With "show where doors lead" on, the
 * body covered the destination as well.
 *
 * So the floor is divided the way the room already is. The archways own the
 * middle band, `BACK.x0`–`BACK.x1`; the WINGS either side of it are floor
 * nobody else is using, and that is where people stand. The name goes at the
 * FEET rather than above the head, below everything the wall hangs — a long
 * name can then run as far inboard as it likes, because at that depth there is
 * nothing to run into.
 *
 * Pure and separate from the drawing so the one rule that matters — a figure
 * never overlaps the arch band — can be asserted rather than eyeballed.
 */

/** Feet, high enough off the bottom edge to hang a name below them. */
export const FEET = 282

/** Where the name plate's baseline sits: under the feet, under everything. */
export const TAG_BASELINE = FEET + 11

/**
 * Two, and only two, are drawn.
 *
 * There is one wing each side and a person is not thin. A third would have to
 * stand in the arch band, which is the whole thing this exists to avoid — so
 * the rest are named in a line along the front instead. Four badly-placed
 * silhouettes said less about a room than two clear ones and a count.
 */
export const MAX_DRAWN = 2

/**
 * How far each silhouette reaches either side of its own x.
 *
 * Taken from the shapes in `Figures.tsx`, and they are NOT all the same: a
 * beast is head-down at one end and half again as wide as a person, and a
 * looming figure leans, which pushes its whole upper body off-centre. Placing
 * every kind at the same x put the wide ones back over the archway the wings
 * exist to keep clear.
 */
const EXTENT: Record<FigureKind, { left: number; right: number }> = {
  standing: { left: 17, right: 17 },
  looming: { left: 16, right: 28 },
  small: { left: 12, right: 12 },
  seated: { left: 16, right: 30 },
  beast: { left: 42, right: 33 },
}

export interface Placement {
  x: number
  /** Which way the name plate grows when it is wider than the wing. */
  side: 'left' | 'right'
  /**
   * Drawn mirrored, so the silhouette's LONG end points into the room.
   *
   * A beast is head-down at one end and reaches 42 one way against 33 the
   * other; facing the wrong way in a 60-wide wing, the frame cropped the head
   * off and left a headless slab. Turned round it loses a little tail instead,
   * and the head — the whole thing that says what it is — survives. A looming
   * figure gets the same treatment, which has the side effect of leaning it
   * over the room rather than out of the picture.
   */
  flip: boolean
}

/** Clear of the frame, and clear of the arch band, in that order of stubbornness. */
const EDGE = 2
const KEEP_OFF = 4

/**
 * One wing each, outermost first — the widest part of the floor.
 *
 * The x is solved per KIND rather than fixed, because the wing is only
 * `BACK.x0` wide and not every silhouette fits it the same way. Pushed away
 * from the archways first and off the frame second: a body slightly cropped by
 * the edge of the picture reads as somebody standing close to the wall, while
 * one overlapping a door hides the thing the room is for.
 */
export function placements(kinds: FigureKind[]): Placement[] {
  return kinds.slice(0, MAX_DRAWN).map((kind, i) => {
    const side = i === 0 ? ('left' as const) : ('right' as const)
    const raw = EXTENT[kind]
    // Point the long end inward, so what the frame crops is the short end.
    const flip = side === 'left' ? raw.left > raw.right : raw.right > raw.left
    const e = flip ? { left: raw.right, right: raw.left } : raw

    if (side === 'left') {
      // As far right as the arch band allows, then as far right as the frame
      // demands — and the arch band wins, because a body cropped by the edge
      // of the picture costs less than one standing in a doorway.
      const x = Math.min(ARCH_BAND.x0 - KEEP_OFF - e.right, Math.max(EDGE + e.left, 30))
      return { x, side, flip }
    }
    const x = Math.max(
      ARCH_BAND.x1 + KEEP_OFF + e.left,
      Math.min(VIEW.w - EDGE - e.right, VIEW.w - 30),
    )
    return { x, side, flip }
  })
}

/** What a placed figure actually spans, mirroring included. For the tests, and
 *  for anything else that needs to know where somebody is standing. */
export function spanOf(kind: FigureKind, placement: Placement): { x0: number; x1: number } {
  const raw = EXTENT[kind]
  const e = placement.flip ? { left: raw.right, right: raw.left } : raw
  return { x0: placement.x - e.left, x1: placement.x + e.right }
}

/**
 * The name plate's box, kept on the canvas.
 *
 * Centred on the figure where it fits and pushed inboard where it does not,
 * which is why `side` exists: a long name on the left grows to the right, and
 * one on the right grows to the left, so neither runs off the frame.
 */
export function tagBox(placement: Placement, chars: number): { x: number; w: number } {
  const w = chars * 6.8 + 10
  const raw = placement.x - w / 2
  const x = Math.min(Math.max(raw, 2), VIEW.w - w - 2)
  return { x, w }
}

/** Longest name drawn, so two tags can never meet in the middle. */
export const MAX_NAME = 18

/** The horizontal band the archways and their plates own. Nothing stands here. */
export const ARCH_BAND = { x0: BACK.x0, x1: BACK.x1 } as const
