import { type KeyboardEvent } from 'react'
import type { ExitView, RoomView } from '../roomModel'
import Torch from './Torch'
import { ARCH, archPath, archX, BACK, TORCH, VIEW, WALLS } from './geometry'
import { designFor } from './designs'
import { FloorMotifLayer, WallMotifLayer, WallTextureLayer } from './Texture'
import Arena from './Arena'

interface Props {
  view: RoomView
  flare: boolean
  onExit: (exit: ExitView) => void
}

/** Enter and Space activate a focused archway, the way a button would. */
function keyActivate(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}

function Archway({ exit, lit, onActivate }: { exit: ExitView; lit: boolean; onActivate: () => void }) {
  const x = archX(exit.slot)
  const path = archPath(exit.slot)
  const label =
    exit.kind === 'bricked'
      ? `Bricked archway on digit ${exit.digit}. Tap to chisel through.`
      : `${exit.kind === 'portal' ? 'Stairwell' : 'Archway'} ${exit.digit}: ${exit.label || 'unlabelled'}${
          exit.targetTitle ? `, leads to ${exit.targetTitle}` : ''
        }`

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={keyActivate(onActivate)}
      className="cursor-pointer outline-none focus-visible:opacity-80"
    >
      {/* Opening. A door is a hole into darkness; a bricked arch is filled in. */}
      <path
        d={path}
        fill={exit.kind === 'bricked' ? '#2B241E' : '#141010'}
        stroke={exit.kind === 'bricked' ? '#41525C' : lit ? '#6B5A47' : '#41525C'}
        strokeWidth={2}
      />

      {exit.kind === 'bricked' && (
        <>
          {/* Courses of brick — four lines, not a texture. §3's restraint note. */}
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={x + 4}
              x2={x + ARCH.w - 4}
              y1={ARCH.top + 22 + i * 16}
              y2={ARCH.top + 22 + i * 16}
              stroke="#41525C"
              strokeWidth={1.5}
            />
          ))}
          <text
            x={x + ARCH.w / 2}
            y={ARCH.bottom - 12}
            textAnchor="middle"
            fontSize={16}
            fill="#41525C"
          >
            ⛏
          </text>
        </>
      )}

      {/* F1.6 — a back-edge is a spiral stairwell, not a door, so reconvergence
          never reads as branching. */}
      {exit.kind === 'portal' && (
        <g stroke="#E8A33D" strokeWidth={2} fill="none" opacity={0.9}>
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${x + 16} ${ARCH.bottom - 12 - i * 14}
                  q ${ARCH.w / 2 - 16} -10 ${ARCH.w - 32} 0`}
            />
          ))}
        </g>
      )}

      {/* F1.8 — an iron portcullis. Notch count encodes how many conditions the
          gate has, so a 3-condition gate looks heavier than a 1-condition one. */}
      {exit.gate && exit.gate.behavior !== 'divert' && (
        <g stroke="#8FB0C2" strokeWidth={2} opacity={0.85}>
          {Array.from({ length: Math.max(1, Math.min(exit.gate.conditionCount, 5)) }).map((_, i) => (
            <line
              key={i}
              x1={x + 6}
              x2={x + ARCH.w - 6}
              y1={ARCH.top + 30 + i * 12}
              y2={ARCH.top + 30 + i * 12}
            />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={x + ARCH.w * f}
              x2={x + ARCH.w * f}
              y1={ARCH.top + 24}
              y2={ARCH.bottom - 4}
            />
          ))}
        </g>
      )}

      {/* A trapdoor glyph marks a divert gate — the floor is not what it seems. */}
      {exit.gate?.behavior === 'divert' && (
        <path
          d={`M ${x + 14} ${ARCH.bottom - 6} l ${ARCH.w - 28} 0 l -8 -10 l -${ARCH.w - 44} 0 Z`}
          fill="none"
          stroke="#8C2F22"
          strokeWidth={2}
        />
      )}

      {/* Digit carved on the lintel. */}
      <text
        x={x + ARCH.w / 2}
        y={ARCH.top - 6}
        textAnchor="middle"
        fontSize={18}
        fontFamily="Cinzel, Georgia, serif"
        letterSpacing="0.12em"
        fill={exit.kind === 'bricked' ? '#41525C' : lit ? '#E4D9BE' : '#6B5A47'}
      >
        {exit.digit}
      </text>

      {/* F1.7 — a chest sits at the door it belongs to, so you can see which
          choice grants the item rather than which room contains it. */}
      {exit.grants.length > 0 && (
        <text x={x + ARCH.w - 6} y={ARCH.bottom - 4} fontSize={16}>
          🎁
        </text>
      )}
      {exit.revokes.length > 0 && (
        <ellipse
          cx={x + 12}
          cy={ARCH.bottom - 4}
          rx={9}
          ry={4}
          fill="#141010"
          stroke="#8C2F22"
          strokeWidth={1.5}
        />
      )}
    </g>
  )
}

export default function DungeonRoom({ view, flare, onExit }: Props) {
  const lit = view.torchLit

  // §3: unlit rooms render dim, lit rooms brighten and a wash spills from the
  // torch. Which browns those are is the design's business — the rule that dark
  // means unrecorded is not.
  const d = designFor(view.design)
  const pick = (pair: { lit: string; dim: string }) => (lit ? pair.lit : pair.dim)
  const wall = pick(d.wall)
  const wallDim = pick(d.wallShaded)
  const edge = pick(d.edge)
  const floor = pick(d.floor)

  return (
    <svg
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full"
      role="img"
      aria-label={`Room ${view.node.slug}, ${lit ? 'torchlit' : 'dark'}${
        view.fight ? `, a fight with ${view.fight.fight.opponent_name}` : ''
      }${view.depth !== null ? `, depth ${view.depth}` : ''}`}
    >
      <defs>
        <radialGradient id="torchwash" cx={TORCH.x / VIEW.w} cy={TORCH.y / VIEW.h} r="0.85">
          <stop offset="0%" stopColor={d.glow.inner} stopOpacity={0.32} />
          <stop offset="45%" stopColor={d.glow.outer} stopOpacity={0.12} />
          <stop offset="100%" stopColor="#141010" stopOpacity={0} />
        </radialGradient>
        <clipPath id="backwall">
          <polygon points={WALLS.back} />
        </clipPath>
      </defs>

      {/* Five flat polygons. That is the whole room. A design that opens
          upward simply omits the ceiling, so the room reads as unbounded. */}
      {!d.openCeiling && <polygon points={WALLS.ceiling} fill={wallDim} />}
      {/* A room with no walls draws only its floor, so the doors read as
          standing in open dark rather than set into something. */}
      {!d.openWalls && (
        <>
          <polygon points={WALLS.left} fill={wall} />
          <polygon points={WALLS.right} fill={wallDim} />
          <polygon points={WALLS.back} fill={wall} />
        </>
      )}
      <polygon points={WALLS.floor} fill={floor} />

      <WallTextureLayer texture={d.texture} color={pick(d.edge)} lit={lit} />
      <WallMotifLayer motif={d.wallMotif} color={pick(d.edge)} lit={lit} />
      <FloorMotifLayer motif={d.floorMotif} color={pick(d.edge)} lit={lit} />

      {/* Joins, drawn rather than shaded — no gradients pretending to be light. */}
      <g stroke={edge} strokeWidth={1.5} fill="none">
        {!d.openWalls && <polygon points={WALLS.back} />}
        {!d.openCeiling && (
          <>
            <line x1={0} y1={0} x2={BACK.x0} y2={BACK.y0} />
            <line x1={VIEW.w} y1={0} x2={BACK.x1} y2={BACK.y0} />
          </>
        )}
        <line x1={0} y1={VIEW.h} x2={BACK.x0} y2={BACK.y1} />
        <line x1={VIEW.w} y1={VIEW.h} x2={BACK.x1} y2={BACK.y1} />
        {/* With no walls, the floor's far edge is the only horizon. */}
        {d.openWalls && <line x1={BACK.x0} y1={BACK.y1} x2={BACK.x1} y2={BACK.y1} />}
      </g>

      {view.fight ? (
        /* A fight fills the room. The way onward is won, not chosen, so there
           are no archways to draw. */
        <Arena fight={view.fight} lit={lit} />
      ) : view.isEnding ? (
        /* F1.9 — rubble and a skull. No exits, and the way ends here. */
        <g>
          <path
            d={`M ${BACK.x0 + 30} ${BACK.y1} l 40 -34 l 46 20 l 44 -28 l 52 42 Z`}
            fill="#241E19"
            stroke="#6B5A47"
            strokeWidth={1.5}
          />
          <text x={VIEW.w / 2} y={BACK.y1 - 12} textAnchor="middle" fontSize={30}>
            💀
          </text>
        </g>
      ) : (
        view.exits.map((exit) => (
          <Archway key={exit.digit} exit={exit} lit={lit} onActivate={() => onExit(exit)} />
        ))
      )}

      {/* Arrival effects sit centre-floor: the node granted them, not a door. */}
      {view.arrivalGrants.length > 0 && (
        <text x={VIEW.w / 2} y={VIEW.h - 26} textAnchor="middle" fontSize={20}>
          🎁
        </text>
      )}
      {view.arrivalRevokes.length > 0 && (
        <ellipse
          cx={VIEW.w / 2 + 34}
          cy={VIEW.h - 32}
          rx={16}
          ry={7}
          fill="#141010"
          stroke="#8C2F22"
          strokeWidth={2}
        />
      )}

      <Torch lit={lit} flare={flare} />

      {/* The warm wash goes over the walls but under the text, so narration
          stays legible at the bright end. */}
      {lit && (
        <polygon
          points={`0,0 ${VIEW.w},0 ${VIEW.w},${VIEW.h} 0,${VIEW.h}`}
          fill="url(#torchwash)"
          className="delve-glow pointer-events-none"
        />
      )}

      {/* F1.10 — depth notches scratched into the left wall, below the torch, so
          you can see how deep a caller is without leaving the room. Tally-style
          in fives, because twelve individual scratches are uncountable at a
          glance. */}
      {view.depth !== null && view.depth > 0 && (
        <g stroke={lit ? '#E4D9BE' : '#8FB0C2'} strokeWidth={2} opacity={lit ? 0.85 : 0.55}>
          {Array.from({ length: Math.min(view.depth, 15) }).map((_, i) => {
            const group = Math.floor(i / 5)
            const within = i % 5
            const x = 14 + group * 16
            const y = 168
            // Every fifth scratch strikes through the previous four.
            return within === 4 ? (
              <line key={i} x1={x - 2} x2={x + 11} y1={y + 20} y2={y - 2} />
            ) : (
              <line key={i} x1={x + within * 3} x2={x + within * 3} y1={y} y2={y + 18} />
            )
          })}
        </g>
      )}

      {/* Room name carved into the back wall (§4.1). */}
      <text
        x={VIEW.w / 2}
        y={BACK.y0 + 26}
        textAnchor="middle"
        fontFamily="Cinzel, Georgia, serif"
        fontSize={15}
        letterSpacing="0.12em"
        fill={lit ? '#E4D9BE' : '#6B5A47'}
        opacity={lit ? 1 : 0.6}
      >
        {(view.node.title || view.node.slug).toUpperCase().slice(0, 28)}
      </text>
    </svg>
  )
}
