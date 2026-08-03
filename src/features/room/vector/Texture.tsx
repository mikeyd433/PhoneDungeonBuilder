import type { FloorMotif, WallMotif, WallTexture } from './designs'
import { BACK, VIEW } from './geometry'

/**
 * Wall and floor treatments.
 *
 * All of these are a handful of drawn lines clipped to the back wall — not
 * bitmap textures and not gradients pretending to be light. §3's restraint note
 * is explicit that the torch is where the boldness goes and every other surface
 * stays flat and quiet, so a treatment's job is to say "this is timber" in as
 * few strokes as it can and then get out of the way.
 */

const W = BACK.x1 - BACK.x0
const H = BACK.y1 - BACK.y0

export function WallTextureLayer({
  texture,
  color,
  lit,
}: {
  texture: WallTexture
  color: string
  lit: boolean
}) {
  if (texture === 'none') return null
  // Strata need more weight than mortar joins: a cavern is defined by its rock
  // layers, whereas dressed stone is defined by the blocks the joins imply.
  const heavy = texture === 'strata' || texture === 'bone' || texture === 'timbers'
  const opacity = lit ? (heavy ? 0.75 : 0.5) : heavy ? 0.45 : 0.28
  const stroke = { stroke: color, strokeWidth: heavy ? 1.6 : 1, fill: 'none', opacity }

  // Everything is clipped to the back wall so a treatment can never spill onto
  // the floor or out past the room.
  return (
    <g clipPath="url(#backwall)" {...stroke}>
      {texture === 'courses' &&
        [1, 2, 3, 4].map((i) => {
          const y = BACK.y0 + (H / 5) * i
          return (
            <g key={i}>
              <line x1={BACK.x0} x2={BACK.x1} y1={y} y2={y} />
              {/* Staggered vertical joins, so courses read as blocks. */}
              {[0, 1, 2, 3].map((j) => {
                const x = BACK.x0 + (W / 4) * j + (i % 2 ? W / 8 : 0)
                return <line key={j} x1={x} x2={x} y1={y} y2={y - H / 5} />
              })}
            </g>
          )
        })}

      {texture === 'strata' &&
        [0, 1, 2, 3, 4, 5, 6].map((i) => {
          const y = BACK.y0 + (H / 7) * i + 5
          // Rock layers sag, and no two are parallel.
          const sag = 7 + (i % 3) * 4
          return (
            <path
              key={i}
              d={`M ${BACK.x0} ${y} q ${W * 0.28} ${sag} ${W * 0.5} ${i % 2 ? 4 : -4} t ${W * 0.5} ${i % 2 ? -3 : 5}`}
            />
          )
        })}

      {texture === 'planks' &&
        [1, 2, 3, 4, 5].map((i) => (
          <line
            key={i}
            x1={BACK.x0}
            x2={BACK.x1}
            y1={BACK.y0 + (H / 6) * i}
            y2={BACK.y0 + (H / 6) * i}
          />
        ))}

      {texture === 'bark' &&
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const x = BACK.x0 + (W / 8) * i + 6
          // Grain runs up the wall and wanders.
          return (
            <path
              key={i}
              d={`M ${x} ${BACK.y0} q ${i % 2 ? 7 : -7} ${H / 2} ${i % 3 ? 3 : -3} ${H}`}
            />
          )
        })}

      {texture === 'bone' &&
        [0, 1, 2, 3].map((row) =>
          [0, 1, 2, 3, 4, 5, 6].map((col) => {
            const x = BACK.x0 + (W / 7) * col + 4
            const y = BACK.y0 + (H / 4) * row + 12
            // A long bone seen end-on: a shaft with two knuckles.
            return (
              <g key={`${row}-${col}`}>
                <line x1={x} x2={x + W / 7 - 8} y1={y} y2={y} />
                <circle cx={x} cy={y} r={2} />
                <circle cx={x + W / 7 - 8} cy={y} r={2} />
              </g>
            )
          }),
        )}

      {texture === 'tiles' &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <line
              x1={BACK.x0}
              x2={BACK.x1}
              y1={BACK.y0 + (H / 6) * i}
              y2={BACK.y0 + (H / 6) * i}
            />
            <line
              x1={BACK.x0 + (W / 6) * i}
              x2={BACK.x0 + (W / 6) * i}
              y1={BACK.y0}
              y2={BACK.y1}
            />
          </g>
        ))}

      {/* Flowstone: mineral curtains sheeting down the wall, fat at the top
          and tapering. Wet limestone, drawn as the thing it does rather than
          as a rock texture. */}
      {texture === 'flowstone' &&
        [0, 1, 2, 3, 4, 5].map((i) => {
          const x = BACK.x0 + (W / 6) * i + W / 12
          const drop = H * (0.55 + (i % 3) * 0.15)
          return (
            <path
              key={i}
              d={`M ${x - 14} ${BACK.y0} q 6 ${drop * 0.5} 0 ${drop} q 8 ${drop * 0.2} 14 0 q -6 ${-drop * 0.5} 0 ${-drop} Z`}
              strokeWidth={1.2}
            />
          )
        })}

      {/* Facets: angular planes catching light. Straight lines only — a crystal
          has no curves in it, and that is most of what tells it from rock. */}
      {texture === 'facets' &&
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const x = BACK.x0 + (W / 8) * i
          const y = BACK.y0 + (H / 3) * (i % 3)
          return (
            <path
              key={i}
              d={`M ${x} ${y} l ${W / 16} ${-H / 5} l ${W / 16} ${H / 4} l ${-W / 20} ${H / 3} Z`}
              strokeWidth={1.2}
            />
          )
        })}

      {/* Timbers: uprights carrying a header. Mine framing is the one texture
          that is structural — it is holding the roof up, and it should look
          like it could stop. */}
      {texture === 'timbers' && (
        <>
          <line x1={BACK.x0} x2={BACK.x1} y1={BACK.y0 + 16} y2={BACK.y0 + 16} strokeWidth={3} />
          {[0, 1, 2, 3, 4].map((i) => {
            const x = BACK.x0 + (W / 4) * i
            return <line key={i} x1={x} x2={x} y1={BACK.y0 + 16} y2={BACK.y1} strokeWidth={2.5} />
          })}
        </>
      )}

      {/* Brick: small, hard, and coursed tighter than dressed stone — a tunnel
          lining rather than a wall somebody built to be looked at. */}
      {texture === 'brick' &&
        [1, 2, 3, 4, 5, 6, 7].map((i) => {
          const y = BACK.y0 + (H / 8) * i
          return (
            <g key={i}>
              <line x1={BACK.x0} x2={BACK.x1} y1={y} y2={y} />
              {[0, 1, 2, 3, 4, 5, 6, 7].map((j) => {
                const x = BACK.x0 + (W / 8) * j + (i % 2 ? W / 16 : 0)
                return <line key={j} x1={x} x2={x} y1={y} y2={y - H / 8} />
              })}
            </g>
          )
        })}

      {/* Frost: long cracks running through ice, branching once. */}
      {texture === 'frost' &&
        [0, 1, 2, 3, 4].map((i) => {
          const x = BACK.x0 + (W / 5) * i + 10
          const y = BACK.y0 + (i % 2 ? 10 : 30)
          return (
            <g key={i}>
              <path d={`M ${x} ${y} l ${18 + i * 4} ${H * 0.35} l ${-10} ${H * 0.4}`} />
              <path d={`M ${x + 18 + i * 4} ${y + H * 0.35} l 22 ${-18}`} />
            </g>
          )
        })}

      {texture === 'ribs' &&
        [0, 1, 2, 3, 4, 5].map((i) => {
          const x = BACK.x0 + (W / 6) * i + W / 12
          return <path key={i} d={`M ${x} ${BACK.y0} q 10 ${H / 2} 0 ${H}`} strokeWidth={2} />
        })}
    </g>
  )
}

/**
 * A corridor that keeps going: door frames receding down BOTH side walls.
 *
 * The first attempt drew nested arches on the back wall, where the three real
 * archways sit on top of them — so the motif was invisible and the design was
 * indistinguishable from dressed stone. The side walls are empty, and doors
 * marching away into the distance is what an endless hallway actually looks
 * like.
 *
 * Drawn in the same one-point perspective as the room: at depth t the left wall
 * runs from x = 0 to x = BACK.x0, top edge sloping down and bottom edge sloping
 * up, so a door is a trapezoid that shrinks toward the back.
 */
export function WallMotifLayer({
  motif,
  color,
  lit,
}: {
  motif: WallMotif | undefined
  color: string
  lit: boolean
}) {
  if (motif === 'stalactites') {
    // Teeth from the ceiling, and a few answering from the floor. The one mark
    // that says "cave" faster than any wall treatment can.
    return (
      <g fill={color} opacity={lit ? 0.5 : 0.28}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
          const x = BACK.x0 + (W / 9) * i + 8
          const len = 14 + ((i * 7) % 22)
          return <path key={i} d={`M ${x - 7} ${BACK.y0} L ${x + 7} ${BACK.y0} L ${x} ${BACK.y0 + len} Z`} />
        })}
        {[1, 3, 6].map((i) => {
          const x = BACK.x0 + (W / 9) * i + 20
          const len = 10 + ((i * 5) % 12)
          return <path key={`up-${i}`} d={`M ${x - 5} ${BACK.y1} L ${x + 5} ${BACK.y1} L ${x} ${BACK.y1 - len} Z`} />
        })}
      </g>
    )
  }

  if (motif === 'squeeze') {
    // The rock closes in from both sides, so the way through is narrower than
    // the room you are standing in.
    return (
      <g fill={color} opacity={lit ? 0.42 : 0.24}>
        <path d={`M ${BACK.x0} ${BACK.y0} L ${BACK.x0 + 54} ${BACK.y0} q -18 ${H / 2} 6 ${H} L ${BACK.x0} ${BACK.y1} Z`} />
        <path d={`M ${BACK.x1} ${BACK.y0} L ${BACK.x1 - 54} ${BACK.y0} q 18 ${H / 2} -6 ${H} L ${BACK.x1} ${BACK.y1} Z`} />
      </g>
    )
  }

  if (motif === 'shelves') {
    return (
      <g stroke={color} fill="none" opacity={lit ? 0.5 : 0.28} strokeWidth={1.5}>
        {[1, 2, 3, 4].map((i) => {
          const y = BACK.y0 + (H / 5) * i
          return (
            <g key={i}>
              <line x1={BACK.x0 + 6} x2={BACK.x1 - 6} y1={y} y2={y} strokeWidth={2} />
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => {
                const x = BACK.x0 + 10 + j * ((W - 20) / 10) + ((i + j) % 3)
                return <line key={j} x1={x} x2={x} y1={y} y2={y - H / 5 + 4} />
              })}
            </g>
          )
        })}
      </g>
    )
  }

  if (motif !== 'receding') return null

  // Side wall geometry at depth t (0 = nearest the viewer, 1 = at the back wall).
  const leftX = (t: number) => BACK.x0 * t
  const rightX = (t: number) => VIEW.w - BACK.x0 * t
  const topY = (t: number) => BACK.y0 * t
  const botY = (t: number) => VIEW.h - (VIEW.h - BACK.y1) * t

  const door = (t0: number, t1: number, side: 'left' | 'right') => {
    const x = side === 'left' ? leftX : rightX
    // The door occupies the middle band of the wall's height at that depth.
    const y = (t: number, f: number) => topY(t) + (botY(t) - topY(t)) * f
    return `M ${x(t0)} ${y(t0, 0.35)} L ${x(t1)} ${y(t1, 0.35)} L ${x(t1)} ${y(t1, 0.92)} L ${x(t0)} ${y(t0, 0.92)} Z`
  }

  return (
    <g stroke={color} fill="none" opacity={lit ? 0.55 : 0.3} strokeWidth={1.5}>
      {(
        [
          [0.12, 0.42],
          [0.55, 0.8],
        ] as const
      ).map(([a, b], i) => (
        <g key={i}>
          <path d={door(a, b, 'left')} />
          <path d={door(a, b, 'right')} />
        </g>
      ))}
    </g>
  )
}

export function FloorMotifLayer({
  motif,
  color,
  lit,
}: {
  motif: FloorMotif
  color: string
  lit: boolean
}) {
  if (motif === 'none') return null
  const opacity = lit ? 0.55 : 0.3

  if (motif === 'water') {
    // A waterline with a few ripples. Horizontal only — anything more reads as
    // motion, and this floor is not moving.
    return (
      <g stroke={color} fill="none" opacity={opacity} strokeWidth={1.5}>
        {[0, 1, 2].map((i) => {
          const y = BACK.y1 + 26 + i * 26
          const inset = 40 + i * 34
          return (
            <path
              key={i}
              d={`M ${inset} ${y} q 30 -4 60 0 t 60 0 t 60 0 t 60 0`}
              transform={`translate(${-inset / 2} 0)`}
            />
          )
        })}
      </g>
    )
  }

  if (motif === 'rubble') {
    return (
      <g stroke={color} fill="none" opacity={opacity} strokeWidth={1.5}>
        {[
          [70, 250],
          [150, 275],
          [255, 262],
          [330, 285],
          [200, 292],
        ].map(([x, y], i) => (
          <path key={i} d={`M ${x} ${y} l 9 -7 l 11 4 l -6 6 Z`} />
        ))}
      </g>
    )
  }

  if (motif === 'grate') {
    return (
      <g stroke={color} fill="none" opacity={opacity} strokeWidth={1.5}>
        <rect x={VIEW.w / 2 - 34} y={BACK.y1 + 44} width={68} height={30} />
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1={VIEW.w / 2 - 34 + i * 17}
            x2={VIEW.w / 2 - 34 + i * 17}
            y1={BACK.y1 + 44}
            y2={BACK.y1 + 74}
          />
        ))}
      </g>
    )
  }

  if (motif === 'chasm') {
    // A gap across the floor with nothing under it. Drawn in the room's own
    // perspective: wider as it comes toward you, and filled with the same
    // black an open archway uses, because it means the same thing.
    return (
      <g>
        <path
          d={`M ${BACK.x0 + 40} ${BACK.y1 + 14} L ${BACK.x1 - 40} ${BACK.y1 + 14} L ${VIEW.w - 20} ${VIEW.h} L 20 ${VIEW.h} Z`}
          fill="#0C0A08"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.9}
        />
        {/* Broken lip on the near edge, so it reads as a floor that gave way
            rather than a rectangle painted on. */}
        <path
          d={`M ${BACK.x0 + 40} ${BACK.y1 + 14} l 22 -6 l 26 5 l 30 -7 l 34 6 l 28 -5 l 26 7`}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={opacity}
        />
      </g>
    )
  }

  if (motif === 'rails') {
    // A cart track running away from you, converging the way everything else
    // in this room does.
    const near = 64
    const far = 22
    return (
      <g stroke={color} fill="none" opacity={opacity} strokeWidth={1.5}>
        <line x1={VIEW.w / 2 - near} x2={VIEW.w / 2 - far} y1={VIEW.h} y2={BACK.y1 + 6} />
        <line x1={VIEW.w / 2 + near} x2={VIEW.w / 2 + far} y1={VIEW.h} y2={BACK.y1 + 6} />
        {[0, 1, 2, 3, 4].map((i) => {
          const t = i / 5
          const y = VIEW.h - (VIEW.h - BACK.y1 - 6) * t
          const half = near - (near - far) * t
          return <line key={i} x1={VIEW.w / 2 - half} x2={VIEW.w / 2 + half} y1={y} y2={y} />
        })}
      </g>
    )
  }

  if (motif === 'channel') {
    // A gutter down the middle, running toward you, with the water in it.
    return (
      <g stroke={color} fill="none" opacity={opacity} strokeWidth={1.5}>
        <path
          d={`M ${VIEW.w / 2 - 16} ${BACK.y1 + 4} L ${VIEW.w / 2 - 52} ${VIEW.h} M ${VIEW.w / 2 + 16} ${BACK.y1 + 4} L ${VIEW.w / 2 + 52} ${VIEW.h}`}
        />
        {[0, 1, 2].map((i) => {
          const y = BACK.y1 + 26 + i * 26
          const half = 20 + i * 11
          return <path key={i} d={`M ${VIEW.w / 2 - half} ${y} q ${half} 6 ${half * 2} 0`} />
        })}
      </g>
    )
  }

  if (motif === 'pool') {
    // Still water: one edge and a couple of reflections, nothing moving.
    return (
      <g opacity={opacity}>
        <path
          d={`M 40 ${VIEW.h} L ${VIEW.w - 40} ${VIEW.h} L ${BACK.x1 - 30} ${BACK.y1 + 16} L ${BACK.x0 + 30} ${BACK.y1 + 16} Z`}
          fill={color}
          opacity={0.16}
        />
        {[0, 1].map((i) => (
          <line
            key={i}
            x1={VIEW.w / 2 - 46 + i * 30}
            x2={VIEW.w / 2 - 20 + i * 30}
            y1={VIEW.h - 26 - i * 22}
            y2={VIEW.h - 26 - i * 22}
            stroke={color}
            strokeWidth={1.5}
          />
        ))}
      </g>
    )
  }

  // sand — a few drift lines following the floor's perspective
  return (
    <g stroke={color} fill="none" opacity={opacity * 0.8} strokeWidth={1}>
      {[0, 1, 2].map((i) => {
        const y = BACK.y1 + 22 + i * 28
        return <path key={i} d={`M ${60 - i * 18} ${y} q ${VIEW.w / 2} ${8 + i * 3} ${VIEW.w - 120 + i * 36} 0`} />
      })}
    </g>
  )
}
