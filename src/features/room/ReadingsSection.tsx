import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import GateBuilder from '@/features/state/GateBuilder'
import { fromFlat, toFlat, type FlatGate } from '@/features/state/gateShape'
import { describeExpression } from '@/features/state/describe'
import TakeRecorder from '@/features/audio/TakeRecorder'
import { estimateSeconds } from '@/lib/speech'
import LoopBackSheet from './LoopBackSheet'
import { doorShows, variantProblems, variantsOf } from './variants'
import { errorText } from '@/lib/errorText'

/**
 * The room, read differently depending on what the caller is carrying.
 *
 * Sits under the narration rather than in the Items tab, because these are the
 * room's WORDS — an author adding one is writing, not wiring. What it needs
 * from the items tab is only the condition, and that is the same builder the
 * gates use so there is one thing to learn.
 *
 * The order is the meaning: first match wins, and the room's own narration is
 * the "otherwise" at the bottom. Shown as a numbered chain with the fallback
 * spelled out, because an if/elsif whose order is invisible is one somebody
 * will reorder by accident.
 */
export default function ReadingsSection({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const refresh = useDelve((s) => s.refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which reading is having its destination chosen. */
  const [routing, setRouting] = useState<string | null>(null)

  if (!graph) return null
  const node = graph.nodes.get(nodeId)
  if (!node) return null

  const story = graph.story
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const readings = variantsOf(graph, nodeId)
  const problems = variantProblems(graph, nodeId)
  const doors = [...graph.choices.values()]
    .filter((c) => c.from_node_id === nodeId)
    .sort((a, b) => a.digit.localeCompare(b.digit) || a.sort_order - b.sort_order)

  /**
   * Which doors one reading offers.
   *
   * Ticked = offered, which is the way round an author thinks about it, while
   * what is STORED is what is hidden — no rows means every door, so a door
   * added tomorrow shows up in a reading written today.
   */
  const Doors = ({ variantId }: { variantId: string | null }) =>
    doors.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <span className="text-xs text-mortar">Doors offered</span>
        <div className="flex flex-wrap gap-2">
          {doors.map((door) => {
            const shown = doorShows(graph, door.id, variantId)
            return (
              <label key={door.id} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={shown}
                  disabled={busy}
                  onChange={(e) =>
                    void run(() =>
                      api.setDoorHidden(story.id, door.id, variantId, !e.target.checked),
                    )
                  }
                  className="accent-torch"
                />
                <span className={shown ? 'text-parchment' : 'text-cold line-through'}>
                  {door.digit} {door.label || '(unlabelled)'}
                </span>
              </label>
            )
          })}
        </div>
      </div>
    )

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

  const field =
    'w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch'

  return (
    <div className="flex flex-col gap-3 rounded border border-mortar/40 p-3">
      <span className="text-xs uppercase tracking-wider text-mortar">
        Reads differently if…
      </span>
      <p className="text-xs text-cold">
        Checked on the way IN, top to bottom. The first one the caller satisfies decides what they
        hear here — and, if you give it a destination, where they end up. None matching means the
        room as written above.
      </p>
      <p className="text-xs text-cold">
        One take each: a reading can&apos;t be split between two actors the way the room&apos;s own
        text can. For two outcomes with <em>different conversations and different doors</em>, leave
        the words blank and send each one to its own room — that room has a full cast, script and
        exits of its own.
      </p>

      {readings.map((variant, i) => {
        const flat = toFlat(variant.expression)
        return (
          <div key={variant.id} className="flex flex-col gap-2 rounded border border-mortar/30 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-torch">
                {i + 1}. When {describeExpression(vars, variant.expression)}
              </span>
              <div className="flex items-center gap-1">
                {/* Order is the meaning here, so it is movable — and only by
                    one step at a time, which is how an if/elsif chain is
                    actually reasoned about. */}
                <button
                  type="button"
                  disabled={i === 0 || busy}
                  aria-label={`Move reading ${i + 1} up`}
                  onClick={() =>
                    void run(async () => {
                      const above = readings[i - 1]
                      await api.updateVariant(variant.id, { sort_order: i - 1 })
                      await api.updateVariant(above.id, { sort_order: i })
                    })
                  }
                  className="px-1 text-mortar disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === readings.length - 1 || busy}
                  aria-label={`Move reading ${i + 1} down`}
                  onClick={() =>
                    void run(async () => {
                      const below = readings[i + 1]
                      await api.updateVariant(variant.id, { sort_order: i + 1 })
                      await api.updateVariant(below.id, { sort_order: i })
                    })
                  }
                  className="px-1 text-mortar disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove reading ${i + 1}`}
                  onClick={() => {
                    const ok = window.confirm(
                      `Delete this reading?${variant.audio_path ? '\n\nIts recording goes with it.' : ''}`,
                    )
                    if (ok) void run(() => api.deleteVariant(variant.id))
                  }}
                  className="px-1 text-grave"
                >
                  ✕
                </button>
              </div>
            </div>

            {flat ? (
              <GateBuilder
                flat={flat}
                vars={vars}
                onChange={(next: FlatGate) =>
                  void run(() => api.updateVariant(variant.id, { expression: fromFlat(next) }))
                }
              />
            ) : (
              <p className="text-xs text-cold">
                This condition is nested more deeply than the builder shows, so it is left alone.
              </p>
            )}

            <textarea
              key={`${variant.id}:${variant.narration}`}
              rows={3}
              defaultValue={variant.narration}
              placeholder="The lamp catches the far wall, and there is a door in it after all."
              aria-label={`What the caller hears for reading ${i + 1}`}
              onBlur={(e) =>
                e.target.value !== variant.narration &&
                void run(() => api.updateVariant(variant.id, { narration: e.target.value }))
              }
              className={field}
            />
            <span className="text-xs text-mortar">
              {variant.narration.length} chars · ~{estimateSeconds(variant.narration)}s
            </span>

            <Doors variantId={variant.id} />

            {/* Where this one leaves the caller. The same picker the doors
                use, so "somewhere they have already been" is as easy here as
                it is there — an arrival check very often sends them back. */}
            <button
              type="button"
              onClick={() => setRouting(variant.id)}
              className="self-start rounded border border-mortar/60 px-3 py-2 text-left text-xs hover:border-torch"
            >
              {variant.goto_node_id ? (
                <>
                  → then go to{' '}
                  <span className="text-torch">
                    {graph.nodes.get(variant.goto_node_id)?.title ||
                      graph.nodes.get(variant.goto_node_id)?.slug ||
                      '— gone —'}
                  </span>
                </>
              ) : (
                <span className="text-cold">→ then stay here and offer this room&apos;s doors</span>
              )}
            </button>

            {/* Recorded like everything else, and silence if it isn't: this
                reading REPLACES the room's words, so an unrecorded one plays
                nothing at all rather than falling back. */}
            <TakeRecorder
              name={`${node.slug}-alt${i + 1}`}
              path={variant.audio_path}
              durationMs={variant.audio_duration_ms}
              onSaved={(path, ms) =>
                run(() => api.updateVariant(variant.id, { audio_path: path, audio_duration_ms: ms }))
              }
            />
          </div>
        )
      })}

      {readings.length > 0 && (
        <div className="flex flex-col gap-2 rounded border border-mortar/25 p-2">
          <p className="text-xs text-cold">Otherwise: the room as written above.</p>
          {/* The fallback is a reading slot like any other, and a real one to
              hide a door in — "the grate is only there if you have the lamp"
              is a door switched OFF here and left on above. */}
          <Doors variantId={null} />
        </div>
      )}

      {routing &&
        (() => {
          const variant = readings.find((v) => v.id === routing)
          if (!variant) return null
          const n = readings.indexOf(variant) + 1
          return (
            <LoopBackSheet
              fromNodeId={nodeId}
              currentId={variant.goto_node_id}
              heading={`Reading ${n}: where does this caller end up?`}
              blurb="They do not press anything for this — arriving is what triggers it, so whatever you pick is where they are standing a moment later."
              wayHint="Sending them back the way they came is how a check turns one room into a junction."
              clearLabel="Nowhere — they stay in this room"
              onPick={(id) => void run(() => api.updateVariant(variant.id, { goto_node_id: id }))}
              onClose={() => setRouting(null)}
            />
          )
        })()}

      {problems.map((problem) => (
        <p key={problem} className="text-xs text-grave">
          {problem}
        </p>
      ))}

      <button
        type="button"
        disabled={busy || vars.length === 0}
        onClick={() =>
          void run(() =>
            api.createVariant(story.id, nodeId, {
              sort_order: readings.length,
              // Starts with a real condition rather than an empty one: an empty
              // `and` is true, so a blank reading would immediately shadow the
              // room's own words and the author would see it replaced by nothing.
              expression: { op: 'and', args: [{ op: 'has', var: vars[0].slug }] },
            }),
          )
        }
        className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
      >
        + Add an alternate reading
      </button>

      {vars.length === 0 && (
        <p className="text-xs text-cold">
          Create an item first — on the Items tab — and this room can read differently for a caller
          carrying it.
        </p>
      )}

      {error && <p className="text-xs text-grave">{error}</p>}
    </div>
  )
}
