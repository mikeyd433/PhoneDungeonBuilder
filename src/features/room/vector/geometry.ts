/**
 * One-point perspective, computed once and shared.
 *
 * §3's restraint note: flat vector walls with ONE perspective trapezoid for the
 * floor. No stone textures, no drop shadows imitating depth, no fake 3D. The
 * whole room is five flat polygons meeting at a back wall.
 *
 * Everything lives in a single 400x300 viewBox so the archways stay welded to
 * the walls at every screen size — splitting the art across SVG and HTML would
 * let them drift apart as the aspect ratio changes.
 */
export const VIEW = { w: 400, h: 300 } as const

/** The back wall rectangle; every trapezoid is the join between this and the frame. */
export const BACK = { x0: 60, y0: 40, x1: 340, y1: 200 } as const

export const WALLS = {
  floor: `0,${VIEW.h} ${VIEW.w},${VIEW.h} ${BACK.x1},${BACK.y1} ${BACK.x0},${BACK.y1}`,
  ceiling: `0,0 ${VIEW.w},0 ${BACK.x1},${BACK.y0} ${BACK.x0},${BACK.y0}`,
  left: `0,0 ${BACK.x0},${BACK.y0} ${BACK.x0},${BACK.y1} 0,${VIEW.h}`,
  right: `${VIEW.w},0 ${BACK.x1},${BACK.y0} ${BACK.x1},${BACK.y1} ${VIEW.w},${VIEW.h}`,
  back: `${BACK.x0},${BACK.y0} ${BACK.x1},${BACK.y0} ${BACK.x1},${BACK.y1} ${BACK.x0},${BACK.y1}`,
} as const

/** Where the torch is bracketed, on the left wall (§3). */
export const TORCH = { x: 30, y: 120 } as const

const ARCH_W = 70
const ARCH_TOP = 112
const GAP = 10

/** Left / centre / right archway placement on the back wall. */
export function archX(slot: number): number {
  const total = ARCH_W * 3 + GAP * 2
  const start = BACK.x0 + ((BACK.x1 - BACK.x0) - total) / 2
  return start + slot * (ARCH_W + GAP)
}

export const ARCH = { w: ARCH_W, top: ARCH_TOP, bottom: BACK.y1 } as const

/** A rounded archway: straight jambs, semicircular head. */
export function archPath(slot: number): string {
  const x = archX(slot)
  const r = ARCH_W / 2
  const springLine = ARCH_TOP + r
  return [
    `M ${x} ${ARCH.bottom}`,
    `L ${x} ${springLine}`,
    `A ${r} ${r} 0 0 1 ${x + ARCH_W} ${springLine}`,
    `L ${x + ARCH_W} ${ARCH.bottom}`,
    'Z',
  ].join(' ')
}
