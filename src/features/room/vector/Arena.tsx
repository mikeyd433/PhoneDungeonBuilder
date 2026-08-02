import type { FightView } from '@/features/fight/model'
import { BACK, VIEW } from './geometry'

/**
 * A fight, drawn where the archways would be.
 *
 * §0's first rule holds here as everywhere: nothing on this is decoration. The
 * silhouette's height is the number of rounds, so a three-round fight is
 * visibly bigger than a one-round fight; the tally under it is rounds again, as
 * a count you can read exactly; and the shape goes red-outlined the moment the
 * fight is unwinnable, so a broken fight cannot look finished.
 *
 * The opponent is deliberately abstract. A specific creature would be atmosphere
 * — the thing the spec keeps warning against — and this has to stand in for a
 * shark, a bouncer and whatever else gets written later.
 */
export default function Arena({ fight, lit }: { fight: FightView; lit: boolean }) {
  const rounds = Math.max(fight.rounds.length, 1)
  const broken = fight.problems.length > 0

  const cx = VIEW.w / 2
  const floorY = BACK.y1
  // Two rounds is a scrap; five is a boss. Clamped so a long fight can't grow
  // through the ceiling.
  const height = Math.min(40 + rounds * 22, BACK.y1 - BACK.y0 - 16)
  const halfWidth = Math.min(34 + rounds * 6, 78)
  const topY = floorY - height

  const outline = broken ? '#8C2F22' : lit ? '#E4D9BE' : '#6B5A47'

  return (
    <g>
      {/* The opponent: one angular silhouette, shoulders wider than the head. */}
      <path
        d={[
          `M ${cx - halfWidth} ${floorY}`,
          `L ${cx - halfWidth * 0.72} ${topY + height * 0.34}`,
          `L ${cx - halfWidth * 0.3} ${topY + height * 0.16}`,
          `L ${cx - halfWidth * 0.24} ${topY}`,
          `L ${cx + halfWidth * 0.24} ${topY}`,
          `L ${cx + halfWidth * 0.3} ${topY + height * 0.16}`,
          `L ${cx + halfWidth * 0.72} ${topY + height * 0.34}`,
          `L ${cx + halfWidth} ${floorY}`,
          'Z',
        ].join(' ')}
        fill="#141010"
        stroke={outline}
        strokeWidth={2}
      />

      {/* Eyes. The only warm thing in the shape, and the reason it reads as
          facing you rather than as a rock. */}
      {[-1, 1].map((side) => (
        <circle
          key={side}
          cx={cx + side * halfWidth * 0.11}
          cy={topY + height * 0.09}
          r={3}
          fill={broken ? '#8C2F22' : '#E8A33D'}
        />
      ))}

      {/* Rounds, as a tally on the floor in front of the opponent — the same
          language as the depth notches, because it is the same kind of fact. */}
      <g stroke={lit ? '#E4D9BE' : '#8FB0C2'} strokeWidth={2} opacity={0.8}>
        {Array.from({ length: Math.min(fight.rounds.length, 8) }).map((_, i) => (
          <line
            key={i}
            x1={cx - 28 + i * 8}
            x2={cx - 28 + i * 8}
            y1={floorY + 14}
            y2={floorY + 26}
          />
        ))}
      </g>

      <text
        x={cx}
        y={floorY + 44}
        textAnchor="middle"
        fontFamily="Cinzel, Georgia, serif"
        fontSize={13}
        letterSpacing="0.12em"
        fill={broken ? '#8C2F22' : lit ? '#E4D9BE' : '#6B5A47'}
      >
        {fight.fight.opponent_name.toUpperCase().slice(0, 24)}
      </text>
    </g>
  )
}
