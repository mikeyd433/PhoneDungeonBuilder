import { useEffect, useRef, useState, type TouchEvent } from 'react'
import type { ExitView, RoomView } from './roomModel'
import DungeonRoom from './vector/DungeonRoom'
import { speakerHex } from '@/features/cast/colors'
import { useToggle } from '@/lib/preference'

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
  /** Rewrite what the caller hears at a door, without leaving this room. */
  onRelabelExit?: (choiceId: string, label: string) => void
  /** Rename the room a door leads to. That room is not the one being rendered,
   *  which is the whole point: the plates show it, so they should edit it. */
  onRenameTarget?: (nodeId: string, title: string) => void
  /** Point a door at a room that already exists — including one behind you.
   *  Takes a DIGIT, not a choice id: the blank arch has no choice row yet, and
   *  it is the one that most needs this. */
  onWire?: (digit: string) => void
  /** Open the reaction for a door — what is heard between pressing and
   *  arriving. Here rather than in the editor because it belongs beside the
   *  label it reacts to, not in a list of wiring. */
  onReact?: (choiceId: string) => void
  /** Fork this door on an item: one key, two rooms. Beside the destination it
   *  splits, for the same reason the reaction sits beside its label. */
  onFork?: (choiceId: string) => void
  /** When this door is offered at all — one control over what used to be two
   *  unrelated mechanisms in two different places. */
  onOffered?: (choiceId: string) => void
  /** Everything about this door, in one sheet. The row keeps only the things
   *  worth scanning; the rest is one tap away rather than six icons wide. */
  onOpenDoor?: (choiceId: string) => void
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
  onRelabelExit,
  onRenameTarget,
  onReact,
  onFork,
  onOffered,
  onOpenDoor,
  onWire,
}: RoomStageProps) {
  const { node } = view
  /**
   * The doors panel, open by default.
   *
   * This app is a workshop, not a reader: what a room's doors say and where
   * they go is the thing you came to check, and the first tap in every room
   * was the one that turned it on. So it starts on and REMEMBERS being turned
   * off, because somebody reading the story rather than building it wants the
   * wall and nothing else.
   */
  const [peek, setPeek] = useToggle('doors-panel', true)

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

  // Kept here rather than per-room, so surveying a branch doesn't mean tapping
  // this again in every doorway. Walking somewhere re-keys the room, not the
  // stage, so the setting rides along.
  const hasDoors = view.exits.length > 0 || view.overflowExits.length > 0

  // Every arch on the wall, in keypad order — including the blank one.
  //
  // The blank arch used to be left out because it has no choice row behind it
  // and so nothing to name. But tapping it in the room chisels a BRAND NEW
  // room, which is the wrong answer when what you want is a door back to the
  // hub: you would get an orphan to delete afterwards. Listing it here gives
  // that arch the other answer.
  const editable = [...view.exits, ...view.overflowExits]

  return (
    <div
      key={node.id}
      className="delve-enter flex min-h-0 flex-1 flex-col"
      onTouchStart={onTouchStart}
      /* F1.4 — swipe right retreats. */
      onTouchEnd={swipeHandler(undefined, onRetreat)}
    >
      <DungeonRoom view={view} flare={flare} onExit={handleExit} peek={peek} />


      {/* Where the doors go. The narration sometimes says so and sometimes
          doesn't, and the arch itself only ever carried the digit — so without
          this the only way to learn a door's destination was to walk through
          it and then walk back. */}
      {hasDoors && (
        <div className="px-4 pt-2">
          <button
            onClick={() => setPeek(!peek)}
            aria-pressed={peek}
            className={[
              'rounded border px-3 py-1.5 text-xs',
              peek ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
            ].join(' ')}
          >
            {peek ? '👁 Hide where doors lead' : '👁 Show where doors lead'}
          </button>
        </div>
      )}

      {/* The plates, made editable, in the order they stand on the wall.
          Both fields belong to somewhere else: the label is the door's, and the
          name is the NEXT room's. Reaching either used to mean walking there or
          opening the editor — but this is where you are when you notice they
          are wrong. */}
      {peek && editable.length > 0 && (
        <ul className="flex flex-col gap-2 px-4 pt-2">
          {editable.map((exit, i) => {
            const target = exit.targetId
            // Doors that converge. Three doors granting three different items
            // and landing in one room is the ordinary shape here, not an edge
            // case — but rendering that one room's name in three identical
            // boxes read as three separate fields, so typing in one looked like
            // it had wrongly changed the other two. Name it once; say so on the
            // rest.
            const firstHere = editable.findIndex((e) => e.targetId && e.targetId === target)
            const sharedWith = target && firstHere !== i ? editable[firstHere].digit : null

            // The blank arch: nothing to label and nothing to name yet, so it
            // gets the one thing it needs — the other way to fill it.
            if (!exit.choiceId) {
              return (
                <li
                  key={`blank-${exit.digit}`}
                  className="flex flex-wrap items-center gap-2 rounded border border-dashed border-mortar/25 p-2"
                >
                  <span className="w-6 shrink-0 text-center font-carved text-mortar">
                    {exit.digit}
                  </span>
                  <span className="text-xs text-cold">no door here yet</span>
                  {onWire && (
                    <button
                      onClick={() => onWire(exit.digit)}
                      className="rounded border border-mortar/50 px-2 py-1.5 text-xs text-mortar hover:border-torch hover:text-torch"
                    >
                      ↺ send it back to a room that exists
                    </button>
                  )}
                  <span className="text-xs text-cold">or tap the arch to cut a new room</span>
                </li>
              )
            }

            return (
              <li
                key={exit.choiceId}
                className="flex flex-wrap items-center gap-2 rounded border border-mortar/25 p-2"
              >
                <span
                  title={
                    exit.keyClash
                      ? 'Two doors on this key — only the first is reachable on the phone'
                      : undefined
                  }
                  className={[
                    'w-6 shrink-0 text-center font-carved',
                    exit.keyClash ? 'text-grave' : 'text-torch',
                  ].join(' ')}
                >
                  {exit.digit}
                </span>
                {/* §0's first rule: every visual element encodes real data.
                    "Always offered" is the absence of data and every door
                    starts that way, so it earns no room on the line. Making a
                    door conditional lives in its sheet. */}
                {onOffered && exit.gate?.behavior === 'hide' && (
                  <button
                    type="button"
                    onClick={() => onOffered(exit.choiceId!)}
                    aria-label={`When door ${exit.digit} is offered`}
                    title="Only offered sometimes — tap to see when"
                    className="shrink-0 rounded border border-torch/60 px-2 py-1.5 text-xs text-torch"
                  >
                    sometimes
                  </button>
                )}
                <input
                  // Remounts when the value changes underneath — two doors to
                  // the same room both show its name, and renaming from one has
                  // to move the other. Typing never remounts, because the graph
                  // only changes on blur.
                  key={`label:${exit.choiceId}:${exit.label}`}
                  defaultValue={exit.label}
                  placeholder="what the caller hears"
                  aria-label={`What the caller hears at door ${exit.digit}`}
                  disabled={!onRelabelExit}
                  onBlur={(e) =>
                    e.target.value !== exit.label &&
                    onRelabelExit?.(exit.choiceId!, e.target.value)
                  }
                  className="min-w-0 flex-1 basis-40 rounded border border-mortar/60 bg-stone px-2 py-1.5 text-sm outline-none focus:border-torch disabled:opacity-60"
                />
                {/* Named here too: the whole reason the plate names them is
                    that doors granting different items often go to the same
                    room, and this list has the same job. Read-only — the items
                    themselves are wired in the editor. */}
                {(exit.grants.length > 0 || exit.revokes.length > 0) && (
                  <span className="flex shrink-0 flex-wrap gap-1 text-xs">
                    {exit.grants.map((slug) => (
                      <span key={`g:${slug}`} className="rounded bg-torch/15 px-1.5 py-0.5 text-torch">
                        +{slug}
                      </span>
                    ))}
                    {exit.revokes.map((slug) => (
                      <span key={`r:${slug}`} className="rounded bg-grave/20 px-1.5 py-0.5 text-grave">
                        −{slug}
                      </span>
                    ))}
                  </span>
                )}
                {sharedWith ? (
                  <span className="min-w-0 flex-1 basis-40 px-2 py-1.5 text-xs text-cold">
                    → the same room as door {sharedWith}
                    {exit.targetTitle ? `, ${exit.targetTitle}` : ''}. This door&apos;s own words
                    are on the left.
                  </span>
                ) : target ? (
                  <input
                    key={`title:${target}:${exit.targetTitle ?? ''}`}
                    // Empty when the room is unnamed, so the placeholder shows
                    // the slug rather than the field pretending the slug is a
                    // name you already wrote.
                    defaultValue={exit.targetTitled ? (exit.targetTitle ?? '') : ''}
                    placeholder={exit.targetTitle ?? 'name of the room it leads to'}
                    aria-label={`Name of the room behind door ${exit.digit}`}
                    disabled={!onRenameTarget}
                    onBlur={(e) => {
                      const was = exit.targetTitled ? (exit.targetTitle ?? '') : ''
                      if (e.target.value !== was) onRenameTarget?.(target, e.target.value)
                    }}
                    className="min-w-0 flex-1 basis-40 rounded border border-mortar/60 bg-stone px-2 py-1.5 font-carved text-sm outline-none focus:border-torch disabled:opacity-60"
                  />
                ) : onWire ? (
                  <button
                    onClick={() => onWire(exit.digit)}
                    className="flex-1 basis-40 rounded border border-dashed border-mortar/50 px-2 py-1.5 text-xs text-cold hover:border-torch hover:text-torch"
                  >
                    leads nowhere yet — send it somewhere
                  </button>
                ) : (
                  <span className="flex-1 basis-40 px-2 py-1.5 text-xs text-cold">
                    leads nowhere yet
                  </span>
                )}
                {/* One key, two rooms. Beside the destination it splits, and
                    when it does the second room is named here too — a door
                    that goes to two places must not read like one that goes to
                    one. Only when there is no door sheet to hold it: six icon
                    buttons for three doors is what the sheet exists to end. */}
                {!onOpenDoor && onFork && exit.choiceId && (
                  <button
                    onClick={() => onFork(exit.choiceId!)}
                    aria-label={`Where door ${exit.digit} forks`}
                    title={
                      exit.forksTo
                        ? `Forks: otherwise leads to ${exit.forksTo}`
                        : 'Send this door to a different room depending on what they carry'
                    }
                    className={[
                      'shrink-0 rounded border px-2 py-1.5 text-xs',
                      exit.forksTo ? 'border-torch/60 text-torch' : 'border-mortar/40 text-mortar',
                    ].join(' ')}
                  >
                    ⑂{exit.forksTo ? ` ${exit.forksTo}` : ''}
                  </button>
                )}

                {/* The reaction to taking this door — what is heard between the
                    keypress and arriving. Beside the label because that is what
                    it answers, and marked so a room's doors can be scanned for
                    an unrecorded one without opening each. */}
                {!onOpenDoor && onReact && (
                  <button
                    onClick={() => onReact(exit.choiceId!)}
                    aria-label={`Reaction to door ${exit.digit}`}
                    title={
                      exit.reaction === 'recorded'
                        ? 'Reaction — recorded'
                        : exit.reaction === 'written'
                          ? 'Reaction — written, not recorded'
                          : 'Add a reaction to taking this door'
                    }
                    className={[
                      'shrink-0 rounded border px-2 py-1.5',
                      exit.reaction === 'recorded'
                        ? 'border-torch/60 text-torch'
                        : exit.reaction === 'written'
                          ? 'border-grave/60 text-grave'
                          : 'border-mortar/40 text-mortar',
                    ].join(' ')}
                  >
                    🔊
                  </button>
                )}

                {/* One tap to everything else: the digit, the destination, the
                    fork, the reaction, insert and remove. The row keeps what is
                    worth scanning and nothing more. */}
                {onOpenDoor && exit.choiceId && (
                  <button
                    onClick={() => onOpenDoor(exit.choiceId!)}
                    aria-label={`Everything about door ${exit.digit}`}
                    title="The digit, where it leads, the fork, the reaction, insert, remove"
                    className={[
                      'shrink-0 rounded border px-2 py-1.5 text-xs',
                      exit.forksTo || exit.reaction !== 'none'
                        ? 'border-torch/60 text-torch'
                        : 'border-mortar/40 text-mortar',
                    ].join(' ')}
                  >
                    ⋯{exit.forksTo ? ' ⑂' : ''}
                    {exit.reaction === 'recorded' ? ' 🔊' : exit.reaction === 'written' ? ' ○' : ''}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* The fight, as a caller meets it: one round at a time, each with the
          move that answers it. Shown in full because this is the authoring
          view — the caller only ever hears one round. */}
      {view.fight && (
        <section className="px-4 pt-3 text-sm">
          {/* Each round, with where every digit actually goes. The destination
              is what the author needs to see — "which one is right" is only one
              of the shapes a round can take. */}
          <ol className="flex flex-col gap-1">
            {view.fight.table.map(({ round, cells }, i) => (
              <li key={round.id} className="rounded border border-mortar/40 px-3 py-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-carved text-xs text-mortar">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {round.opponent_move || <span className="text-cold">nothing announced</span>}
                  </span>
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {cells.map((cell) => (
                    <li key={cell.move.id} className="flex items-baseline gap-1">
                      <span className="font-carved text-torch">{cell.digit}</span>
                      <span className="text-mortar">{cell.move.slug}</span>
                      <span aria-hidden>→</span>
                      <span className={cell.wired ? '' : 'text-grave'}>{cell.where}</span>
                    </li>
                  ))}
                  {cells.length === 0 && <li className="text-grave">no moves to press</li>}
                </ul>
              </li>
            ))}
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
                <span className="min-w-0 truncate">{exit.label || 'unwritten'}</span>
                {(exit.grants.length > 0 || exit.revokes.length > 0) && (
                  <span className="flex shrink-0 gap-1 text-xs">
                    {exit.grants.map((slug) => (
                      <span key={`g:${slug}`} className="text-torch">
                        +{slug}
                      </span>
                    ))}
                    {exit.revokes.map((slug) => (
                      <span key={`r:${slug}`} className="text-grave">
                        −{slug}
                      </span>
                    ))}
                  </span>
                )}
                {peek && exit.kind !== 'bricked' && (
                  <span className="ml-auto flex min-w-0 items-baseline gap-1 text-xs">
                    <span aria-hidden className="text-mortar">
                      →
                    </span>
                    <span className={exit.targetTitle ? 'truncate font-carved' : 'text-grave'}>
                      {exit.targetTitle ?? 'nowhere'}
                    </span>
                  </span>
                )}

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
