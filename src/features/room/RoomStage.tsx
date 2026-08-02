import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { ExitView, RoomView } from './roomModel'
import DungeonRoom from './vector/DungeonRoom'
import { counterFor } from '@/features/fight/model'
import { speakerHex } from '@/features/cast/colors'

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
  /** Walk somewhere with no door involved — a fight's win and lose rooms. */
  onWalk?: (nodeId: string) => void
}

/** Distance in px before a touch counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 60

export default function RoomStage({
  view,
  onEnter,
  onChisel,
  onRetreat,
  onCycleSibling,
  onWalk,
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

      {/* The fight, as a caller meets it: one round at a time, each with the
          move that answers it. Shown in full because this is the authoring
          view — the caller only ever hears one round. */}
      {view.fight && (
        <section className="px-4 pt-3 text-sm">
          <ol className="flex flex-col gap-1">
            {view.fight.rounds.map((round, i) => {
              const answer = counterFor(view.fight!.moves, round)
              const digit = answer
                ? view.fight!.moves.findIndex((m) => m.id === answer.id) + 1
                : null
              return (
                <li
                  key={round.id}
                  className="flex items-baseline gap-3 rounded border border-mortar/40 px-3 py-2"
                >
                  <span className="font-carved text-xs text-mortar">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {round.opponent_move || <span className="text-grave">no move set</span>}
                  </span>
                  {answer && digit && digit <= 9 ? (
                    <span className="shrink-0 text-torch">
                      press {digit} · {answer.slug}
                    </span>
                  ) : (
                    <span className="shrink-0 text-grave">no answer</span>
                  )}
                </li>
              )
            })}
            {view.fight.rounds.length === 0 && (
              <li className="text-cold">No rounds yet — add one in the editor.</li>
            )}
          </ol>

          <div className="mt-2 flex gap-2">
            {(
              [
                ['win', view.fight.fight.win_node_id, view.fight.winTitle],
                ['lose', view.fight.fight.lose_node_id, view.fight.loseTitle],
              ] as const
            ).map(([outcome, id, title]) => (
              <button
                key={outcome}
                disabled={!id || !onWalk}
                onClick={() => id && onWalk?.(id)}
                className={[
                  'flex-1 rounded border px-3 py-2 text-left text-xs disabled:opacity-50',
                  outcome === 'win' ? 'border-torch/60 text-torch' : 'border-grave/60 text-grave',
                ].join(' ')}
              >
                <span className="block uppercase tracking-wider">
                  {outcome === 'win' ? 'If they win' : 'If they lose'}
                </span>
                <span className="text-parchment">{title ?? 'nowhere yet'}</span>
              </button>
            ))}
          </div>

          {view.fight.problems.length > 0 && (
            <ul className="mt-2 rounded border border-grave/40 bg-grave/10 px-3 py-2 text-xs">
              {view.fight.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </section>
      )}

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
        <div
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
          {/* Split into lines, the plaque shows who is speaking. Unsplit, it is
              the same block of text it has always been — the split is a choice
              the author makes room by room, not a migration. */}
          {view.lines.length > 0 ? (
            view.lines.map((line) => (
              <p key={line.id} className="mb-2 last:mb-0">
                {line.speaker && (
                  <span
                    className="mr-2 font-carved text-xs uppercase tracking-[0.12em]"
                    style={{ color: speakerHex(line.color) }}
                  >
                    {line.speaker}
                  </span>
                )}
                <span className={line.speaker ? 'font-voice' : 'text-parchment'}>{line.text}</span>
              </p>
            ))
          ) : (
            <p>{node.narration || <span className="text-cold">Nothing written here yet.</span>}</p>
          )}
        </div>

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
