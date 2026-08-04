import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { errorText } from '@/lib/errorText'
import { DIGITS, type Digit } from '@/types/domain'
import { doorsByDigit } from './keys'
import { effectsSummary, leadsSummary, offeredSummary } from './doorSummary'
import EffectRows from '@/features/state/EffectRows'

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
}: {
  choiceId: string
  onClose: () => void
  onFork: (choiceId: string) => void
  onReact: (choiceId: string) => void
  onOffered: (choiceId: string) => void
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
  const byDigit = doorsByDigit(graph, choice.from_node_id)
  const leads = leadsSummary(graph, choice.id)
  const offered = offeredSummary(graph, choice.id)
  const gives = effectsSummary(graph, choice.id)
  const gate = [...graph.gates.values()].find((g) => g.choice_id === choice.id)

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
                  <option key={d} value={d} disabled={taken}>
                    {d}
                    {taken ? ' (used)' : ''}
                  </option>
                )
              })}
            </select>
            {(byDigit.get(choice.digit)?.length ?? 0) > 1 && (
              <span className="text-xs text-grave">
                Another door is already on this key, and only the first is reachable. Move one.
              </span>
            )}
          </label>

          {/* Where it goes, what it hands over, when it is offered, and what is
              heard on the way — the four questions a door answers, as four
              rows, each ANSWERING it rather than naming it. §0: every visual
              element encodes real data, and "Always, in some states, or on a
              condition" was the same words on a door with rules and a door
              without. */}
          <button type="button" className={row} onClick={() => hop(onFork)}>
            <span className="block text-xs text-mortar">Where it leads</span>
            <span className="text-torch">{leads.text}</span>
            <span className="block text-xs text-cold">{leads.hint}</span>
          </button>

          {/* Edited here rather than linked to. The Items tab is the whole
              room at once and stays the right place for that; what a door
              hands over is a fact about this door, and sending you to another
              surface for it was what made this sheet incomplete. */}
          <div className="rounded border border-mortar/50 px-3 py-2">
            <span className="block text-xs uppercase tracking-wider text-mortar">
              What it gives or takes
            </span>
            {gives && <span className="mb-1 block text-sm text-torch">{gives}</span>}
            <div className="mt-1">
              <EffectRows owner={{ choice_id: choice.id }} />
            </div>
            {gate?.fail_behavior === 'divert' && gives && (
              <span className="mt-1 block text-xs text-cold">
                This door forks, so these apply on the first route only.
              </span>
            )}
          </div>

          <button type="button" className={row} onClick={() => hop(onOffered)}>
            <span className="block text-xs text-mortar">When it is offered</span>
            <span className={offered.never ? 'text-grave' : 'text-parchment'}>{offered.text}</span>
          </button>

          <button type="button" className={row} onClick={() => hop(onReact)}>
            <span className="block text-xs text-mortar">Heard on the way through</span>
            <span className="text-parchment">
              {choice.reaction_narration?.trim() ? choice.reaction_narration.slice(0, 60) : 'Nothing yet'}
            </span>
          </button>

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
