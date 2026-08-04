import { useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import GateBuilder from '@/features/state/GateBuilder'
import { fromFlat, toFlat, type FlatGate } from '@/features/state/gateShape'
import { describeExpression } from '@/features/state/describe'

/**
 * When is this door offered?
 *
 * There used to be two answers, stored differently and reached from different
 * screens: a `hide` gate, and a `hidden_doors` row keyed on which reading the
 * caller arrived under. Same visible result, four taps versus eight, and
 * nothing warned when both were set on one door.
 *
 * Readings are gone, so there is one mechanism left and this is one question:
 * always, or on a condition. What a hide gate cannot do is ANNOUNCE the door —
 * the room reads out the same words to everybody — so that is said here rather
 * than discovered on the phone, with the thing that does do it named.
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
  const hides = gate?.fail_behavior === 'hide'
  const flat = hides ? toFlat(gate.expression) : null

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
          disabled={busy || !hides}
          onClick={() => void run(() => api.deleteGate(choice.id))}
          className={[
            'mb-3 w-full rounded border px-3 py-2 text-left text-sm',
            !hides ? 'border-torch text-torch' : 'border-mortar/60 text-mortar hover:border-torch',
          ].join(' ')}
        >
          <span className="block">Always</span>
          <span className="block text-xs text-cold">Every caller is offered this key.</span>
        </button>

        <div className="rounded border border-mortar/40 p-3">
          <span className="text-xs uppercase tracking-wider text-mortar">
            Only when they are carrying something
          </span>
          {!hides ? (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-cold">
                Checked at the keypad. The key is still accepted — a gather takes what it takes —
                but it goes back to the choices instead of through.
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
              {/* The hole this mechanism has, said where it applies — with the
                  thing that does not have it named. */}
              <p className="text-xs text-cold">
                Nothing announces a door hidden this way: the room reads out the same words to
                everybody. If the caller needs telling it is there, put a{' '}
                <strong className="text-mortar">fork on the door in</strong> instead — that gives
                them a room whose own script can say so.
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

        {error && <p className="mt-2 text-xs text-grave">{error}</p>}
      </div>
    </div>
  )
}
