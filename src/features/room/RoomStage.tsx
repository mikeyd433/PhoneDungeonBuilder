import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { ExitView, RoomView } from './roomModel'
import DungeonRoom from './vector/DungeonRoom'

/**
 * The room renderer seam.
 *
 * Everything visual about a room goes through this props contract. Swapping the
 * flat-vector implementation for a sprite pack means writing another component
 * with this same signature and changing one import — no logic moves, because the
 * component receives a fully-derived RoomView and never touches the graph.
 */
export interface RoomStageProps {
  view: RoomView
  onEnter: (exit: ExitView) => void
  onChisel: (exit: ExitView) => void
  onRetreat: () => void
  /** F1.11 — cycle to the previous/next room sharing this one's parent. */
  onCycleSibling?: (direction: 1 | -1) => void
}

/** Distance in px before a touch counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 60

export default function RoomStage({
  view,
  onEnter,
  onChisel,
  onRetreat,
  onCycleSibling,
}: RoomStageProps) {
  const { node } = view

  // §3: lighting the torch is the reward for recording a node, and that
  // transition gets a half-second flare. Fires only on the dark -> lit edge, not
  // on arrival in an already-lit room.
  const wasLit = useRef(view.torchLit)
  const [flare, setFlare] = useState(false)
  useEffect(() => {
    if (view.torchLit && !wasLit.current) {
      setFlare(true)
      const t = setTimeout(() => setFlare(false), 520)
      return () => clearTimeout(t)
    }
    wasLit.current = view.torchLit
  }, [view.torchLit])

  // Re-key the room wrapper on the node id so the slide animation replays when
  // you walk somewhere new (§4.1, 250ms left-to-right).
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }

  const swipeHandler =
    (onLeft: (() => void) | undefined, onRight: (() => void) | undefined) => (e: TouchEvent) => {
      const start = touchStart.current
      touchStart.current = null
      if (!start) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      // Ignore mostly-vertical drags so scrolling never triggers navigation.
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
      if (dx > 0) onRight?.()
      else onLeft?.()
    }

  const handleExit = (exit: ExitView) =>
    exit.kind === 'bricked' ? onChisel(exit) : onEnter(exit)

  return (
    <div
      key={node.id}
      className="delve-enter flex min-h-0 flex-1 flex-col"
      onTouchStart={onTouchStart}
      /* F1.4 — swipe right retreats. */
      onTouchEnd={swipeHandler(undefined, onRetreat)}
    >
      <DungeonRoom view={view} flare={flare} onExit={handleExit} />

      {/* F1.13 — beyond three, exits stack rather than crowd the walls. */}
      {view.overflowExits.length > 0 && (
        <ul className="flex flex-col gap-1 px-4 pt-3">
          {view.overflowExits.map((exit) => (
            <li key={exit.digit}>
              <button
                onClick={() => handleExit(exit)}
                className={[
                  'flex w-full items-center gap-3 rounded border px-3 py-2 text-left text-sm',
                  exit.kind === 'bricked'
                    ? 'border-cold/60 text-cold'
                    : 'border-mortar/60 hover:border-torch',
                ].join(' ')}
              >
                <span className="font-carved">{exit.digit}</span>
                <span>{exit.label || 'unwritten'}</span>
                {exit.grants.length > 0 && <span className="ml-auto">🎁</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Floor plaque. F1.11 — swiping it sideways cycles siblings, which is the
          fast way to review a whole choice set without walking back up. */}
      <div className="px-4 pb-4 pt-3">
        <p
          onTouchStart={onTouchStart}
          onTouchEnd={swipeHandler(
            onCycleSibling && view.siblings.length > 1 ? () => onCycleSibling(1) : undefined,
            onCycleSibling && view.siblings.length > 1 ? () => onCycleSibling(-1) : undefined,
          )}
          className={[
            'rounded border border-mortar/40 bg-depth/50 p-4 text-lg leading-relaxed transition-opacity duration-500',
            view.torchLit ? 'opacity-100' : 'opacity-60',
          ].join(' ')}
        >
          {node.narration || <span className="text-cold">Nothing written here yet.</span>}
        </p>

        {view.siblings.length > 1 && (
          <p className="mt-2 text-center text-xs text-mortar">
            {view.siblings.indexOf(node.id) + 1} of {view.siblings.length} on this landing · swipe
            the plaque to compare
          </p>
        )}
      </div>
    </div>
  )
}
