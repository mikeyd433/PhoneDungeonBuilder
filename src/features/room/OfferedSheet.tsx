import { useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import GateBuilder from '@/features/state/GateBuilder'
import { fromFlat, toFlat, type FlatGate } from '@/features/state/gateShape'
import { describeExpression, shortCondition } from '@/features/state/describe'
import NewItemButton from '@/features/state/NewItemButton'
import { doorShows, variantsOf } from './variants'

/**
 * When is this door offered?
 *
 * There were two answers to that question and they lived nowhere near each
 * other. A `hide` gate — Items tab, "Require something", then change "say why"
 * to "don't offer the choice at all" — works in any room and checks a
 * condition. A `hidden_doors` row — the state plate, or a checkbox grid in the
 * readings editor — works only where the room has readings and keys off which
 * one applied. Same visible result, different storage, eight taps versus four,
 * and nothing warned when both were set on one door.
 *
 * So this is the one control, and it picks the mechanism from the answer:
 *
 *   Always              — no gate, no rows. What every door starts as.
 *   Only in some states — `hidden_doors` rows for the states left unticked.
 *   Only when …         — a `hide` gate carrying the condition.
 *
 * Both are still shown when both are set, because the honest thing to do with
 * a door somebody has configured twice is say so rather than silently drop one.
 */
export default function OfferedSheet({
  choiceId,
  onClose,
}: {
  choiceId: string
  onClose: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const refresh = useDelve((s) => s.refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choice = graph?.choices.get(choiceId)
  const gate = useMemo(
    () => (graph ? [...graph.gates.values()].find((g) => g.choice_id === choiceId) : undefined),
    [graph, choiceId],
  )

  if (!graph || !choice) return null

  const story = graph.story
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const named = vars.map((v) => ({ slug: v.slug, name: v.name }))
  const readings = variantsOf(graph, choice.from_node_id)
  const hidesByCondition = gate?.fail_behavior === 'hide'
  const flat = hidesByCondition ? toFlat(gate.expression) : null

  /** Every state of the room this door leaves, base first. */
  const slots: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'As written' },
    ...readings.map((v) => ({ id: v.id, label: shortCondition(named, v.expression) })),
  ]
  const hiddenSomewhere = slots.some((s) => !doorShows(graph, choice.id, s.id))

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** Back to "always": clear whichever of the two mechanisms is in play. */
  const offerAlways = () =>
    void run(async () => {
      if (hidesByCondition) await api.deleteGate(choice.id)
      for (const slot of slots) {
        if (!doorShows(graph, choice.id, slot.id)) {
          await api.setDoorHidden(story.id, choice.id, slot.id, false)
        }
      }
    })

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            When is {choice.label ? `“${choice.label}”` : `digit ${choice.digit}`} offered?
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Done
          </button>
        </div>

        <button
          type="button"
          disabled={busy || (!hidesByCondition && !hiddenSomewhere)}
          onClick={offerAlways}
          className={[
            'mb-3 w-full rounded border px-3 py-2 text-left text-sm',
            !hidesByCondition && !hiddenSomewhere
              ? 'border-torch text-torch'
              : 'border-mortar/60 text-mortar hover:border-torch',
          ].join(' ')}
        >
          <span className="block">Always</span>
          <span className="block text-xs text-cold">
            Every caller is offered this key, in every state.
          </span>
        </button>

        {/* ---- by state. Only where there is more than one state to choose. */}
        <div className="mb-4 rounded border border-mortar/40 p-3">
          <span className="text-xs uppercase tracking-wider text-mortar">Only in some states</span>
          {readings.length === 0 ? (
            /* The third trap: a visibility rule needs the room to have a
               reading first, and the only warning came from the export,
               afterwards. Said here, with the button that fixes it — the
               reading that offers a door is also the one that announces it,
               which is the whole reason to prefer this over a condition. */
            <div className="mt-1 flex flex-col gap-2">
              <p className="text-xs text-cold">
                This room reads one way, so there are no states to choose between yet. A reading is
                the version of the room a caller carrying something hears — and the version that
                mentions this door.
              </p>
              <button
                type="button"
                disabled={busy || vars.length === 0}
                title={vars.length === 0 ? 'Make an item first — there is a button below' : undefined}
                onClick={() =>
                  void run(() =>
                    api.createVariant(story.id, choice.from_node_id, {
                      sort_order: 0,
                      expression: { op: 'has', var: vars[0].slug },
                    }),
                  )
                }
                className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
              >
                + Give this room a second reading
              </button>
              {vars.length === 0 && (
                <NewItemButton
                  label="+ Create the first item"
                  onCreated={(slug) =>
                    run(() =>
                      api.createVariant(story.id, choice.from_node_id, {
                        sort_order: 0,
                        expression: { op: 'has', var: slug },
                      }),
                    )
                  }
                />
              )}
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {slots.map((slot) => {
                const shown = doorShows(graph, choice.id, slot.id)
                return (
                  <label key={String(slot.id)} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={shown}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() =>
                          api.setDoorHidden(story.id, choice.id, slot.id, !e.target.checked),
                        )
                      }
                      className="accent-torch"
                    />
                    <span className={shown ? 'text-parchment' : 'text-cold line-through'}>
                      {slot.label}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* ---- by condition. Works anywhere, which is why it is not hidden
                behind having readings. */}
        <div className="rounded border border-mortar/40 p-3">
          <span className="text-xs uppercase tracking-wider text-mortar">
            Only when they are carrying something
          </span>
          {!hidesByCondition ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-cold">
                Checked at the keypad rather than on arrival, so it works in a room with no
                alternate readings at all.
              </p>
              <button
                type="button"
                disabled={busy || gate !== undefined}
                title={
                  gate
                    ? 'This door already has a requirement — a refusal or a fork. Remove that first.'
                    : undefined
                }
                onClick={() =>
                  void run(() =>
                    api.upsertGate(story.id, choice.id, {
                      expression: { op: 'and', args: [] },
                      fail_behavior: 'hide',
                      fail_node_id: null,
                    }),
                  )
                }
                className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
              >
                + Only offer it on a condition
              </button>
              {gate && (
                <p className="text-xs text-cold">
                  This door already {gate.fail_behavior === 'divert' ? 'forks' : 'refuses'} on a
                  condition. One door carries one, so clear that before setting this.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {flat ? (
                <GateBuilder
                  flat={flat}
                  vars={vars}
                  onChange={(next: FlatGate) =>
                    void run(() =>
                      api.upsertGate(story.id, choice.id, { expression: fromFlat(next) }),
                    )
                  }
                />
              ) : (
                <p className="text-xs text-cold">
                  This condition is nested more deeply than the builder shows, so it is left alone.
                </p>
              )}
              <p className="text-xs text-cold">
                Offered when {describeExpression(named, gate.expression)}.
              </p>
              {/* The hole this mechanism has always had, said where it applies. */}
              <p className="text-xs text-cold">
                Nothing announces a door hidden this way — the room&apos;s recording cannot change
                to suit. Say it in an alternate reading if the caller needs telling.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => api.deleteGate(choice.id))}
                className="self-start text-xs text-grave underline"
              >
                Remove the condition
              </button>
            </div>
          )}
        </div>

        {hidesByCondition && hiddenSomewhere && (
          <p className="mt-3 text-xs text-grave">
            This door is hidden by a state AND by a condition. Either alone would do it — together
            they are two rules to keep in step.
          </p>
        )}

        {error && <p className="mt-2 text-xs text-grave">{error}</p>}
      </div>
    </div>
  )
}
