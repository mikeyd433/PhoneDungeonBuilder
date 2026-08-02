import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapLayout } from './layout'

interface Props {
  layout: MapLayout
  currentId: string | null
  onTeleport: (nodeId: string) => void
  /** Minimap mode: no interaction, no labels, just the shape of the dungeon. */
  thumbnail?: boolean
}

const PAD = 40

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * §4.3 — the surveyor's notebook. Cold blue graph paper, hand-inked, the
 * opposite of the dungeon's warm dark. Switching should feel like stepping
 * outside to check your map.
 *
 * Pinch-zoom and pan, but rooms are never draggable: position is always derived
 * (§0's second rule).
 *
 * Pan and zoom move the **viewBox**, not a CSS transform on the SVG. Mixing a
 * viewBox with a CSS transform means pixel deltas and user units scale
 * independently, so a drag moves the map by the wrong amount and centring
 * computes against a scale the browser never actually used. Driving the viewBox
 * keeps one coordinate system, and screen->user conversion is then exact.
 */
export default function Automap({ layout, currentId, onTeleport, thumbnail }: Props) {
  const roomById = useMemo(() => new Map(layout.rooms.map((r) => [r.id, r])), [layout.rooms])

  /** The whole dungeon, padded. */
  const fitted = useMemo<Box>(
    () => ({
      x: -PAD,
      y: -PAD,
      w: layout.width + PAD * 2,
      h: layout.height + PAD * 2,
    }),
    [layout.width, layout.height],
  )

  const [box, setBox] = useState<Box>(fitted)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null)
  const pinch = useRef<number | null>(null)

  // Refit whenever the dungeon's extent changes. Fitting the whole map beats
  // centring on one room: you open the map to see the shape of the thing, and a
  // fitted view can never land on empty paper.
  useEffect(() => setBox(fitted), [fitted])

  /** Convert a pixel delta to user units — exact, because the viewBox is ours. */
  const perPixel = useCallback(() => {
    const el = svgRef.current
    if (!el) return 1
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return 1
    // preserveAspectRatio="xMidYMid meet" scales by the tighter axis.
    return Math.max(box.w / rect.width, box.h / rect.height)
  }, [box])

  const zoomBy = useCallback(
    (factor: number) => {
      setBox((b) => {
        const maxW = fitted.w * 4
        const minW = fitted.w / 8
        const w = Math.min(maxW, Math.max(minW, b.w / factor))
        const h = b.h * (w / b.w)
        // Zoom about the centre, so the room you are looking at stays put.
        return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }
      })
    },
    [fitted.w],
  )

  const interactive = !thumbnail

  return (
    <div className={thumbnail ? 'h-full w-full' : 'relative h-full w-full bg-paper'}>
      <svg
        ref={svgRef}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={interactive ? 'h-full w-full touch-none' : 'h-full w-full'}
        role={thumbnail ? 'img' : 'application'}
        aria-label="Automap"
        onPointerDown={(e) => {
          if (!interactive) return
          drag.current = { x: e.clientX, y: e.clientY, box }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!interactive || !d || e.buttons === 0) return
          const k = perPixel()
          setBox({
            ...d.box,
            x: d.box.x - (e.clientX - d.x) * k,
            y: d.box.y - (e.clientY - d.y) * k,
          })
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => {
          if (!interactive) return
          zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)
        }}
        onTouchMove={(e) => {
          if (!interactive || e.touches.length !== 2) return
          const [a, b] = [e.touches[0], e.touches[1]]
          const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
          if (pinch.current != null && pinch.current > 0) zoomBy(dist / pinch.current)
          pinch.current = dist
        }}
        onTouchEnd={() => (pinch.current = null)}
      >
        <defs>
          {/* Graph paper, drawn rather than an image — it must stay crisp at any zoom. */}
          <pattern id="graphpaper" width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#8FB0C2" strokeWidth="0.5" />
          </pattern>
          <marker
            id="arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 7 4 L 0 7 z" fill="#1F3A4A" />
          </marker>
        </defs>

        {/* Paper is drawn far wider than the viewBox on purpose. "meet"
            letterboxes the SVG, so a rect sized to the viewBox leaves bare
            margins where the grid stops; overdrawing means the graph paper
            reaches the edges at any aspect ratio and while panning. */}
        <rect
          x={box.x - box.w}
          y={box.y - box.h}
          width={box.w * 3}
          height={box.h * 3}
          fill="#D6E4EC"
        />
        <rect
          x={box.x - box.w}
          y={box.y - box.h}
          width={box.w * 3}
          height={box.h * 3}
          fill="url(#graphpaper)"
        />

        {/* Corridors. Back-edges dashed, so a loop never reads as a new branch.
            A fight's two outcomes are inked in red and told apart by weight:
            the way out you earn is drawn solid, the way out you fall through
            is drawn thin and broken. */}
        {layout.edges.map((edge) => {
          if (edge.points.length < 2) return null
          const d = edge.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
          const lost = edge.outcome === 'lose'
          return (
            <path
              key={edge.id}
              d={d}
              fill="none"
              stroke={edge.outcome ? '#8C2F22' : '#1F3A4A'}
              strokeWidth={lost || edge.isPortal ? 1.5 : 2}
              strokeDasharray={lost ? '2 4' : edge.isPortal ? '6 4' : undefined}
              opacity={lost || edge.isPortal ? 0.75 : 1}
              markerEnd="url(#arrow)"
            />
          )
        })}

        {/* Unwritten branches: a stub corridor ending in a question mark. */}
        {layout.stubs.map((stub) => {
          const room = roomById.get(stub.fromId)
          if (!room) return null
          return (
            <g key={stub.id}>
              <line
                x1={stub.x}
                y1={room.y + room.h}
                x2={stub.x}
                y2={stub.y}
                stroke="#1F3A4A"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <text
                x={stub.x}
                y={stub.y + 12}
                textAnchor="middle"
                fontFamily="'Architects Daughter', cursive"
                fontSize={16}
                fill="#1F3A4A"
              >
                ?
              </text>
            </g>
          )
        })}

        {layout.rooms.map((room) => (
          <g
            key={room.id}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={`${room.slug}${room.isEnding ? ', an ending' : ''}${
              room.isFight ? ', a fight' : ''
            }${room.recorded ? ', recorded' : ''}`}
            onClick={interactive ? () => onTeleport(room.id) : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onTeleport(room.id)
                    }
                  }
                : undefined
            }
            className={interactive ? 'cursor-pointer outline-none' : undefined}
          >
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill={room.isUnreachable ? '#C4B7B0' : '#EAF2F6'}
              stroke={room.isOrphan || room.isUnreachable ? '#8C2F22' : '#1F3A4A'}
              strokeWidth={2}
              /* Written rooms inked; stubs dotted. */
              strokeDasharray={room.written ? undefined : '4 3'}
            />

            {/* Recorded rooms get a filled corner triangle — the automap's
                equivalent of a lit torch. */}
            {room.recorded && (
              <path
                d={`M ${room.x + room.w - 16} ${room.y} L ${room.x + room.w} ${room.y} L ${
                  room.x + room.w
                } ${room.y + 16} Z`}
                fill="#1F3A4A"
              />
            )}

            {room.isEnding && (
              <g stroke="#8C2F22" strokeWidth={3}>
                <line
                  x1={room.x + 6}
                  y1={room.y + 6}
                  x2={room.x + room.w - 6}
                  y2={room.y + room.h - 6}
                />
                <line
                  x1={room.x + room.w - 6}
                  y1={room.y + 6}
                  x2={room.x + 6}
                  y2={room.y + room.h - 6}
                />
              </g>
            )}

            {/* Crossed blades in the top-left corner: a fight. Deliberately not
                the ending's X — that one is heavy, centred and means "stop",
                and two marks meaning different things must not look alike. */}
            {room.isFight && (
              <g stroke="#8C2F22" strokeWidth={2} strokeLinecap="round">
                <line x1={room.x + 5} y1={room.y + 5} x2={room.x + 19} y2={room.y + 19} />
                <line x1={room.x + 19} y1={room.y + 5} x2={room.x + 5} y2={room.y + 19} />
                <circle cx={room.x + 5} cy={room.y + 19} r={2} fill="#8C2F22" strokeWidth={0} />
                <circle cx={room.x + 19} cy={room.y + 19} r={2} fill="#8C2F22" strokeWidth={0} />
              </g>
            )}

            {!thumbnail && (
              <text
                x={room.x + room.w / 2}
                y={room.y + room.h / 2 + 4}
                textAnchor="middle"
                fontFamily="'Architects Daughter', cursive"
                fontSize={12}
                fill="#1F3A4A"
                pointerEvents="none"
                /* An ending's heavy X runs straight through its label; a paper
                   halo keeps the slug readable without lightening the X, which
                   is the stronger signal of the two. */
                stroke="#EAF2F6"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {room.slug.length > 13 ? `${room.slug.slice(0, 12)}…` : room.slug}
              </text>
            )}

            {/* Current location: a red pin. */}
            {room.id === currentId && (
              <g pointerEvents="none">
                <circle cx={room.x + room.w / 2} cy={room.y - 9} r={5} fill="#8C2F22" />
                <line
                  x1={room.x + room.w / 2}
                  y1={room.y - 5}
                  x2={room.x + room.w / 2}
                  y2={room.y + 2}
                  stroke="#8C2F22"
                  strokeWidth={2}
                />
              </g>
            )}
          </g>
        ))}
      </svg>

      {interactive && (
        <div className="absolute bottom-3 right-3 flex gap-2">
          {[
            { label: '−', title: 'Zoom out', run: () => zoomBy(1 / 1.4) },
            { label: '+', title: 'Zoom in', run: () => zoomBy(1.4) },
            { label: '⤢', title: 'Fit the whole dungeon', run: () => setBox(fitted) },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.run}
              title={b.title}
              aria-label={b.title}
              className="h-11 w-11 rounded border border-ink bg-paper font-paper text-ink"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
