import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { errorText } from '@/lib/errorText'
import { DIGITS, type Digit } from '@/types/domain'
import { doorsByDigit } from './keys'
import { variantsOf } from './variants'

/**
 * Everything about one door, in one place.
 *
 * A door's controls were split across two surfaces and neither was complete:
 * the room's doors panel had the label, the room name behind, the fork and the
 * reaction; the editor's Doors tab had the digit, the destination, insert and
 * delete. `label` was the only thing on both, so every door job started with a
 * guess about which screen to open — and at 430px the panel was already six
 * icon buttons for three doors before any of the missing ones arrived.
 *
 * So the row goes quiet — digit, label, where it leads — and everything else
 * lives behind one tap. Nothing new is possible here; what changes is that
 * there is one answer to "where do I edit this door".
 */
export default function DoorSheet({
  choiceId,
  onClose,
  onFork,
  onReact,
  onOffered,
  viewing = 'all',
  onSplitKey,
}: {
  choiceId: string
  onClose: () => void
  onFork: (choiceId: string) => void
  onReact: (choiceId: string) => void
  onOffered: (choiceId: string) => void
  /** The state being stood in, so "a different door on this key" knows which
   *  state it is for. */
  viewing?: string | null | 'all'
  /** Hide this door in the state being stood in and put a new one on its key,
   *  in one go. Absent in the authoring view, where there is no one state the
   *  new door would belong to. */
  onSplitKey?: (choiceId: string) => Promise<void>
  }) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const updateChoice = useDelve((s) => s.updateChoice)
  const deleteChoice = useDelve((s) => s.deleteChoice)
  const insertRoomOnChoice = useDelve((s) => s.insertRoomOnChoice)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choice = graph?.choices.get(choiceId)
  if (!graph || !derived || !choice) return null

  const siblings = derived.children.get(choice.from_node_id) ?? []
  const target = choice.to_node_id ? graph.nodes.get(choice.to_node_id) : null
  const roomHasStates = variantsOf(graph, choice.from_node_id).length > 0
  const byDigit = doorsByDigit(graph, choice.from_node_id)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const hop = (open: (id: string) => void) => {
    onClose()
    open(choiceId)
  }

  const row = 'w-full rounded border border-mortar/50 px-3 py-2 text-left text-sm hover:border-torch'

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            Door {choice.digit}
            {choice.label ? ` — ${choice.label}` : ''}
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Done
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-mortar">
              What the caller hears
            </span>
            <input
              key={`label:${choice.id}:${choice.label}`}
              defaultValue={choice.label}
              placeholder="Grab the harpoon"
              disabled={busy}
              onBlur={(e) =>
                e.target.value !== choice.label &&
                void run(() => updateChoice(choice.id, { label: e.target.value }))
              }
              className="w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wider text-mortar">Which key</span>
            <select
              value={choice.digit}
              disabled={busy}
              onChange={(e) => void run(() => updateChoice(choice.id, { digit: e.target.value as Digit }))}
              className="w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm"
            >
              {DIGITS.map((d) => {
                const taken = siblings.some((c) => c.id !== choice.id && c.digit === d)
                return (
                  <option key={d} value={d} disabled={taken && !roomHasStates}>
                    {d}
                    {taken ? (roomHasStates ? ' (shared)' : ' (used)') : ''}
                  </option>
                )
              })}
            </select>
            {(byDigit.get(choice.digit)?.length ?? 0) > 1 && (
              <span className="text-xs text-cold">
                Another door shares this key. They must not both be offered in one state.
              </span>
            )}
          </label>

          {/* Where it goes, when it is offered, and what is heard on the way —
              the three questions a door answers, as three rows. */}
          <button type="button" className={row} onClick={() => hop(onFork)}>
            <span className="block text-xs text-mortar">Where it leads</span>
            <span className="text-torch">{target?.title || target?.slug || '— nowhere yet —'}</span>
            <span className="block text-xs text-cold">
              Tap to change it, or to fork it on an item.
            </span>
          </button>

          <button type="button" className={row} onClick={() => hop(onOffered)}>
            <span className="block text-xs text-mortar">When it is offered</span>
            <span className="text-parchment">Always, in some states, or on a condition</span>
          </button>

          <button type="button" className={row} onClick={() => hop(onReact)}>
            <span className="block text-xs text-mortar">Heard on the way through</span>
            <span className="text-parchment">
              {choice.reaction_narration?.trim() ? choice.reaction_narration.slice(0, 60) : 'Nothing yet'}
            </span>
          </button>

          {/* The second trap from the walkthroughs: a second door on one key
              only works if the first is already hidden in that state, and
              nothing suggested the order. Here it is one action — hide this
              one here, cut a new one on the same key, for this state only. */}
          {onSplitKey && viewing !== 'all' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onSplitKey(choice.id)
                  onClose()
                })
              }
              className={row}
            >
              <span className="block text-xs text-mortar">In this state</span>
              <span className="text-parchment">
                Make {choice.digit} a different door here
              </span>
              <span className="block text-xs text-cold">
                This door stops being offered in this state, and a new one takes the key — its own
                words, its own destination.
              </span>
            </button>
          )}

          <div className="mt-1 flex flex-wrap gap-2 border-t border-mortar/30 pt-3">
            <button
              type="button"
              disabled={busy || !choice.to_node_id}
              title={
                choice.to_node_id
                  ? 'Put a new room between here and where this goes'
                  : 'This door leads nowhere yet — point it somewhere first'
              }
              onClick={() =>
                void run(async () => {
                  await insertRoomOnChoice(choice.id)
                  onClose()
                })
              }
              className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
            >
              ⤵ Insert a room
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Remove door ${choice.digit}? The room it leads to stays.`))
                  return
                void run(async () => {
                  await deleteChoice(choice.id)
                  onClose()
                })
              }}
              className="rounded border border-grave/60 px-3 py-2 text-xs text-grave"
            >
              ✕ Remove this door
            </button>
          </div>

          {error && <p className="text-xs text-grave">{error}</p>}
        </div>
      </div>
    </div>
  )
}
