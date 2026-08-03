import type { FigureKind } from '@/types/domain'
import { speakerHex } from '@/features/cast/colors'
import { CARVED, VIEW } from './geometry'

/**
 * Somebody standing in the room.
 *
 * Silhouettes, not portraits. §3's restraint note puts all the boldness in the
 * torch and keeps every other surface flat and quiet, and a drawn face would
 * fight the room for attention while saying less than the name tag does. What
 * the shape has to carry is one fact — is this a person, something low, or that
 * looming — and an outline carries it at any size.
 *
 * Built from a head, a torso and legs rather than one clever path: the first
 * attempt drew each figure as a single outline with the head arced into the
 * shoulders, and every one of them came out a blob. Separate parts cannot lose
 * the head, which is the whole thing that says "a person" at this size.
 *
 * They stand in the FOREGROUND, below the arches. A figure that covered a door
 * would hide the one thing on the wall that has to stay readable.
 */

/** Feet on the floor, near the viewer. */
const FEET = VIEW.h - 6

interface Build {
  /** Head radius, and how far the top of the head is above the feet. */
  head: number
  height: number
  shoulder: number
  hip: number
  /** Leaning over you. Shifts the upper body forward. */
  lean: number
}

const BUILDS: Record<FigureKind, Build> = {
  standing: { head: 9, height: 78, shoulder: 15, hip: 11, lean: 0 },
  looming: { head: 10, height: 92, shoulder: 21, hip: 13, lean: 6 },
  small: { head: 7, height: 46, shoulder: 10, hip: 8, lean: 0 },
  seated: { head: 9, height: 54, shoulder: 14, hip: 12, lean: 0 },
  beast: { head: 7, height: 40, shoulder: 0, hip: 0, lean: 0 },
}

function Body({ kind, x, ink, dim }: { kind: FigureKind; x: number; ink: string; dim: number }) {
  const b = BUILDS[kind]
  const top = FEET - b.height
  const skin = { fill: '#100D0B', fillOpacity: 0.92, stroke: ink, strokeWidth: 2, opacity: dim }

  if (kind === 'beast') {
    // Low and long, head down at one end. Not-a-person registers before
    // anything else about it does.
    const y = FEET - b.height
    return (
      <g {...skin} strokeLinejoin="round">
        <path
          d={`M ${x - 30} ${FEET - 12} Q ${x - 32} ${y + 6} ${x - 18} ${y + 8}
              L ${x + 16} ${y + 4} Q ${x + 32} ${y + 2} ${x + 30} ${FEET - 12} Z`}
        />
        <circle cx={x - 34} cy={y + 10} r={b.head} />
        {[-22, -8, 10, 24].map((dx) => (
          <rect key={dx} x={x + dx} y={FEET - 14} width={5} height={14} />
        ))}
      </g>
    )
  }

  if (kind === 'seated') {
    // Knees forward, back upright: not going anywhere, and not getting up.
    return (
      <g {...skin} strokeLinejoin="round">
        <circle cx={x} cy={top + b.head} r={b.head} />
        <path
          d={`M ${x - b.shoulder} ${top + b.head * 2 + 4}
              L ${x + b.shoulder} ${top + b.head * 2 + 4}
              L ${x + b.hip} ${FEET - 16} L ${x - b.hip} ${FEET - 16} Z`}
        />
        {/* Thighs forward, shins down. */}
        <rect x={x - b.hip} y={FEET - 16} width={b.hip * 2 + 12} height={7} rx={2} />
        <rect x={x + b.hip + 5} y={FEET - 16} width={7} height={16} />
      </g>
    )
  }

  const neck = top + b.head * 2
  return (
    <g {...skin} strokeLinejoin="round">
      <circle cx={x + b.lean} cy={top + b.head} r={b.head} />
      {/* Torso: shoulders wider than hips, and set forward when looming. */}
      <path
        d={`M ${x - b.shoulder + b.lean} ${neck + 3}
            L ${x + b.shoulder + b.lean} ${neck + 3}
            L ${x + b.hip} ${FEET - 22} L ${x - b.hip} ${FEET - 22} Z`}
      />
      {/* Two legs with daylight between them — the gap is most of what stops a
          standing figure reading as a post. */}
      <rect x={x - b.hip} y={FEET - 24} width={b.hip - 1} height={24} />
      <rect x={x + 1} y={FEET - 24} width={b.hip - 1} height={24} />
    </g>
  )
}

export default function Figures({
  figures,
  lit,
}: {
  figures: Array<{ id: string; name: string; color: string; kind: FigureKind }>
  lit: boolean
}) {
  if (figures.length === 0) return null

  // Spread across the floor, never more than four — past that they stop being
  // people in a room and start being a crowd the art cannot carry.
  const shown = figures.slice(0, 4)
  const span = VIEW.w * (shown.length > 2 ? 0.72 : 0.48)
  const step = shown.length > 1 ? span / (shown.length - 1) : 0
  const start = shown.length > 1 ? VIEW.w / 2 - span / 2 : VIEW.w * 0.5

  return (
    <g>
      {shown.map((figure, i) => {
        const x = start + i * step
        const ink = speakerHex(figure.color)
        const name =
          figure.name.length > 14 ? `${figure.name.slice(0, 13)}…` : figure.name
        const tagY = FEET - BUILDS[figure.kind].height - 9
        return (
          <g key={figure.id}>
            <Body kind={figure.kind} x={x} ink={ink} dim={lit ? 1 : 0.55} />
            {/* The name tag, on its own plate above the head. Outlined in the
                speaker's colour — the same colour their lines are shown in, so
                the figure and the words are obviously the same person. */}
            <rect
              x={x - name.length * 3.4 - 5}
              y={tagY - 9}
              width={name.length * 6.8 + 10}
              height={13}
              rx={2}
              fill="#141010"
              fillOpacity={0.9}
              stroke={ink}
              strokeWidth={1}
              opacity={lit ? 0.95 : 0.5}
            />
            <text
              x={x}
              y={tagY}
              textAnchor="middle"
              fontSize={9}
              fontFamily={CARVED}
              letterSpacing="0.06em"
              fill={ink}
              opacity={lit ? 1 : 0.6}
            >
              {name}
            </text>
          </g>
        )
      })}
      {figures.length > shown.length && (
        <text x={VIEW.w - 10} y={VIEW.h - 6} textAnchor="end" fontSize={10} fill="#6B5A47">
          +{figures.length - shown.length} more
        </text>
      )}
    </g>
  )
}
