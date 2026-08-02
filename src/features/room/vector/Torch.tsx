import { TORCH } from './geometry'

/**
 * §3, the signature element.
 *
 * Unlit  — cold blue-grey. The node has no audio; the whole room renders dim.
 * Lit    — torch amber, a warm radial wash from this position, text full opacity.
 *
 * This is the entire production-status UI. Walking the dungeon shows you what is
 * finished without a single progress bar, because unfinished territory is
 * literally dark.
 */
export default function Torch({ lit, flare }: { lit: boolean; flare: boolean }) {
  return (
    <g aria-hidden>
      {/* Bracket — same shape lit or not, so only the light changes. */}
      <rect
        x={TORCH.x - 3}
        y={TORCH.y + 6}
        width={6}
        height={22}
        fill="#241C16"
        stroke="#6B5A47"
        strokeWidth={1}
      />

      {lit ? (
        <g className={flare ? 'delve-flare' : undefined}>
          {/* Outer flame */}
          <path
            className="delve-flame"
            d={`M ${TORCH.x} ${TORCH.y - 20}
                C ${TORCH.x + 9} ${TORCH.y - 8}, ${TORCH.x + 7} ${TORCH.y + 4}, ${TORCH.x} ${TORCH.y + 8}
                C ${TORCH.x - 7} ${TORCH.y + 4}, ${TORCH.x - 9} ${TORCH.y - 8}, ${TORCH.x} ${TORCH.y - 20} Z`}
            fill="#E8A33D"
          />
          {/* Inner core, hotter and paler */}
          <path
            className="delve-flame"
            style={{ animationDelay: '-0.6s' }}
            d={`M ${TORCH.x} ${TORCH.y - 11}
                C ${TORCH.x + 4} ${TORCH.y - 4}, ${TORCH.x + 3} ${TORCH.y + 2}, ${TORCH.x} ${TORCH.y + 5}
                C ${TORCH.x - 3} ${TORCH.y + 2}, ${TORCH.x - 4} ${TORCH.y - 4}, ${TORCH.x} ${TORCH.y - 11} Z`}
            fill="#F6D9A0"
          />
        </g>
      ) : (
        /* Cold and dead: the absence of torch, not a greyed-out torch. */
        <path
          d={`M ${TORCH.x} ${TORCH.y - 6}
              C ${TORCH.x + 5} ${TORCH.y - 1}, ${TORCH.x + 4} ${TORCH.y + 3}, ${TORCH.x} ${TORCH.y + 6}
              C ${TORCH.x - 4} ${TORCH.y + 3}, ${TORCH.x - 5} ${TORCH.y - 1}, ${TORCH.x} ${TORCH.y - 6} Z`}
          fill="#41525C"
        />
      )}
    </g>
  )
}
