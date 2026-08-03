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

/**
 * The carved face, for SVG text that cannot reach a Tailwind class.
 *
 * Named once so the room, the arena and the figures cannot drift onto three
 * different fonts — which is exactly what happened while this was a string
 * literal repeated in four files.
 */
export const CARVED = '"Uncial Antiqua", Georgia, serif'

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

/** The most archways the back wall can hold before the rest stack below it. */
export const MAX_WALL_ARCHES = 5

const GAP = 10

/**
 * How wide and how tall an archway is, given how many share the wall.
 *
 * One door is not three doors with two missing — it is a different room, and it
 * should read as one: a single tall arch centred on the back wall, not a narrow
 * one adrift in empty stone. Fewer doors means each is grander; five means they
 * are a row of openings.
 *
 * Tabled rather than computed so each count could be looked at and tuned. Three
 * keeps exactly the numbers it always had, so no existing room moves.
 */
const SIZES: Record<number, { w: number; top: number }> = {
  1: { w: 118, top: 92 },
  2: { w: 96, top: 102 },
  3: { w: 70, top: 112 },
  4: { w: 56, top: 120 },
  5: { w: 46, top: 126 },
}

const sizeFor = (count: number) => SIZES[Math.min(MAX_WALL_ARCHES, Math.max(1, count))]

/** Archway placement on the back wall, centred as a group. */
export function archX(slot: number, count: number): number {
  const { w } = sizeFor(count)
  const n = Math.min(MAX_WALL_ARCHES, Math.max(1, count))
  const total = w * n + GAP * (n - 1)
  const start = BACK.x0 + (BACK.x1 - BACK.x0 - total) / 2
  return start + slot * (w + GAP)
}

/** The arch box for a wall of `count` doors. `bottom` never moves: every
 *  archway stands on the floor line, whatever else changes. */
export function archBox(count: number) {
  const { w, top } = sizeFor(count)
  return { w, top, bottom: BACK.y1 } as const
}

/**
 * Greedy word wrap for a threshold nameplate.
 *
 * SVG text neither wraps nor ellipsizes: it just keeps drawing, straight out
 * over the wall and into the next archway's label. So anything going on a plate
 * has to be broken to width here, before it is drawn. `maxChars` is a per-line
 * budget calibrated to the 70-unit arch at the size it is rendered — the
 * carved face runs far wider per character than the body face, so the two
 * lines of a plate get different budgets.
 *
 * Returns at most `maxLines` lines, with an ellipsis when something was cut, so
 * a truncated room name never reads as a complete one.
 */
export function wrapToPlate(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= maxChars) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    if (lines.length >= maxLines) {
      line = ''
      break
    }
    // A single word wider than the plate has to be cut mid-word; there is no
    // break opportunity in SHIPWRECK_INTERIOR.
    line = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === 0) return []

  // Did everything fit? Compare against the source, ignoring the whitespace we
  // normalised away.
  const shown = lines.join(' ').replace(/…$/, '')
  if (shown.length < text.trim().replace(/\s+/g, ' ').length) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.endsWith('…')
      ? last
      : `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`
  }
  return lines
}

/** A rounded archway: straight jambs, semicircular head. */
export function archPath(slot: number, count: number): string {
  const { w, top, bottom } = archBox(count)
  const x = archX(slot, count)
  const r = w / 2
  const springLine = top + r
  return [
    `M ${x} ${bottom}`,
    `L ${x} ${springLine}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${springLine}`,
    `L ${x + w} ${bottom}`,
    'Z',
  ].join(' ')
}
