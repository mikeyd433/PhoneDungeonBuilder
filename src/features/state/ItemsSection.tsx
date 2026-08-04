import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { slugify } from '@/lib/slug'
import GateBuilder from './GateBuilder'
import EffectRows from './EffectRows'
import { fromFlat, toFlat, type FlatGate } from './gateShape'
import type { Choice, StateVar } from '@/types/domain'
import TakeRecorder from '@/features/audio/TakeRecorder'
import { errorText } from '@/lib/errorText'

/**
 * F8.1–F8.5, in the editor sheet.
 *
 * §2's point: "You are in a room containing a harpoon" shouldn't grant it —
 * *choosing to pick it up* should. So choice-level effects come first here and
 * node-level arrival effects are folded away below them.
 */
export default function ItemsSection({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const refresh = useDelve((s) => s.refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newVar, setNewVar] = useState('')

  if (!graph || !derived) return null
  const story = graph.story
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const choices = derived.children.get(nodeId) ?? []

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

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  /**
   * Two lines an item carries: one for arriving in the satchel, one for
   * leaving it.
   *
   * Folded away, because most items never need either — a key that opens a
   * door says nothing on being picked up, and a row of empty boxes on every
   * item would bury the two that matter. Open once written, so nothing you
   * typed can hide.
   */
  const ItemMoments = ({ item }: { item: StateVar }) => {
    const written = Boolean(item.gain_narration?.trim() || item.spend_narration?.trim())
    const rows: Array<{ move: 'gain' | 'spend'; label: string; hint: string; text: string }> = [
      {
        move: 'gain',
        label: 'When it is picked up',
        hint: 'Heard right after it is granted, at every door and room that gives it.',
        text: item.gain_narration ?? '',
      },
      {
        move: 'spend',
        label: 'When it is used up',
        hint: 'Heard after it is spent or taken away.',
        text: item.spend_narration ?? '',
      },
    ]
    return (
      <details open={written}>
        <summary className="cursor-pointer text-xs text-mortar">
          What it says as it changes hands
          {written && <span className="ml-2 text-torch">·written</span>}
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {rows.map((row) => (
            <label key={row.move} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-mortar">{row.label}</span>
              <input
                key={`${item.id}:${row.move}:${row.text}`}
                defaultValue={row.text}
                placeholder={row.move === 'gain' ? 'The rope is heavier than it looked.' : 'The last of it.'}
                disabled={busy}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next === row.text.trim()) return
                  void run(() =>
                    api.updateStateVar(item.id, {
                      [`${row.move}_narration`]: next || null,
                    }),
                  )
                }}
                className={`${field} w-full text-sm`}
              />
              <span className="text-xs text-cold">{row.hint}</span>
            </label>
          ))}
          {written && (
            <p className="text-xs text-cold">
              Record them with the rest of the story — they are in the queue as{' '}
              <span className="font-carved">{item.slug} — picked up</span> and{' '}
              <span className="font-carved">used up</span>. Unrecorded is silence on the phone.
            </p>
          )}
        </div>
      </details>
    )
  }

  const GateRow = ({ choice }: { choice: Choice }) => {
    const gate = [...graph.gates.values()].find((g) => g.choice_id === choice.id)
    const flat = toFlat(gate?.expression)

    if (!gate) {
      return (
        <button
          onClick={() =>
            void run(() =>
              api.upsertGate(story.id, choice.id, {
                expression: { op: 'and', args: [] },
                fail_behavior: story.default_fail_behavior,
              }),
            )
          }
          className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch"
        >
          + Require something
        </button>
      )
    }

    if (!flat) {
      return (
        <p className="text-xs text-cold">
          This gate&apos;s conditions are nested more deeply than the builder shows. Editing here
          would change what it means, so it is left alone.
        </p>
      )
    }

    return (
      <div className="flex flex-col gap-2 rounded border border-mortar/40 p-2">
        <GateBuilder
          flat={flat}
          vars={vars}
          onChange={(next: FlatGate) =>
            void run(() => api.upsertGate(story.id, choice.id, { expression: fromFlat(next) }))
          }
        />

        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-mortar">If they can&apos;t</span>
          <select
            value={gate.fail_behavior}
            onChange={(e) =>
              void run(() =>
                api.upsertGate(story.id, choice.id, {
                  fail_behavior: e.target.value as typeof gate.fail_behavior,
                  // The DB rejects a divert with no destination, so seed one.
                  fail_node_id:
                    e.target.value === 'divert' ? (gate.fail_node_id ?? nodeId) : gate.fail_node_id,
                }),
              )
            }
            className={field}
          >
            <option value="refuse">say why, and stay here</option>
            <option value="hide">don&apos;t offer the choice at all</option>
            <option value="divert">send them somewhere else</option>
          </select>
        </label>

        {gate.fail_behavior === 'refuse' && (
          <>
            <input
              defaultValue={gate.fail_narration ?? ''}
              placeholder="The gate won't budge — you'd need something to pry it."
              onBlur={(e) =>
                e.target.value !== (gate.fail_narration ?? '') &&
                void run(() =>
                  api.upsertGate(story.id, choice.id, { fail_narration: e.target.value }),
                )
              }
              className={`${field} w-full`}
            />
            {/* A refusal is read aloud like anything else. Without a take the
                exported flow says nothing and bounces the caller back to the
                choices with no explanation. */}
            <TakeRecorder
              name={`${graph.nodes.get(nodeId)?.slug ?? 'room'}-d${choice.digit}-refuse`}
              path={gate.fail_audio_path}
              durationMs={gate.fail_audio_duration_ms}
              onSaved={(path, ms) =>
                run(() =>
                  api.upsertGate(story.id, choice.id, {
                    fail_audio_path: path,
                    fail_audio_duration_ms: ms,
                  }),
                )
              }
            />
          </>
        )}

        {gate.fail_behavior === 'divert' && (
          <select
            value={gate.fail_node_id ?? ''}
            onChange={(e) =>
              void run(() =>
                api.upsertGate(story.id, choice.id, { fail_node_id: e.target.value || null }),
              )
            }
            className={field}
          >
            {[...graph.nodes.values()].map((n) => (
              <option key={n.id} value={n.id}>
                {n.slug}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={gate.consume_on_pass}
            onChange={(e) =>
              void run(() =>
                api.upsertGate(story.id, choice.id, { consume_on_pass: e.target.checked }),
              )
            }
          />
          Use up the item that opened this
        </label>

        <button
          onClick={() => void run(() => api.deleteGate(choice.id))}
          className="self-start text-xs text-grave underline"
        >
          Remove this requirement
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-mortar">
          Items, flags &amp; counters
        </span>
        <div className="flex flex-wrap gap-2">
          {vars.length === 0 && <span className="text-xs text-cold">None yet.</span>}
        </div>

        {/* The name is what the story calls it — on doors, in the satchel, and
            read aloud in the inventory. The slug is what the exported flow
            TESTS, and what every gate is written in terms of, so it is shown
            and not editable: changing it would silently orphan the gates that
            name it. */}
        {vars.length > 0 && (
          <ul className="flex flex-col gap-1">
            {vars.map((v: StateVar) => (
              <li key={v.id} className="flex flex-col gap-1 rounded border border-mortar/25 p-2">
                <div className="flex flex-wrap items-center gap-2">
                <input
                  // Remounts when the value changes underneath, never while
                  // typing — the graph only moves on blur.
                  key={`${v.id}:${v.name}`}
                  defaultValue={v.name}
                  placeholder={v.slug}
                  aria-label={`Name for ${v.slug}`}
                  disabled={busy}
                  onBlur={(e) => {
                    const name = e.target.value.trim()
                    if (name === v.name || name === '') return
                    void run(() => api.updateStateVar(v.id, { name }))
                  }}
                  className={`${field} min-w-0 flex-1 basis-40 text-sm`}
                />
                <span
                  title={`${v.kind} · the identifier the exported flow tests against`}
                  className="shrink-0 font-carved text-xs text-mortar"
                >
                  {v.slug}
                  {v.is_consumable && ' ·used up'}
                </span>
                </div>

                {/* What the ITEM says as it changes hands, wherever that is.
                    A door's reaction is still the place for what is true of
                    that particular threshold; this is for what is true of the
                    thing itself, so it is written once and heard everywhere it
                    is picked up or spent. */}
                <ItemMoments item={v} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={newVar}
            onChange={(e) => setNewVar(e.target.value)}
            placeholder="HARPOON"
            className={`${field} flex-1`}
          />
          <button
            disabled={!newVar.trim() || busy}
            onClick={() =>
              void run(async () => {
                await api.createStateVar(story.id, {
                  slug: slugify(newVar),
                  name: newVar.trim(),
                  kind: 'item',
                })
                setNewVar('')
              })
            }
            className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
          >
            + New
          </button>
        </div>
      </div>

      {/* Choice-level first: most item logic should live here (§2). */}
      {choices.map((choice) => (
        <div key={choice.id} className="flex flex-col gap-2 border-t border-mortar/30 pt-3">
          <span className="text-xs text-mortar">
            Digit {choice.digit} · {choice.label || 'unlabelled'}
          </span>
          <EffectRows owner={{ choice_id: choice.id }} />
          <GateRow choice={choice} />
        </div>
      ))}

      <details className="border-t border-mortar/30 pt-3">
        <summary className="cursor-pointer text-xs uppercase tracking-wider text-mortar">
          On arrival in this room
        </summary>
        <p className="mb-2 mt-2 text-xs text-cold">
          Fires whichever way the caller got here. Most item logic belongs on the door they chose,
          not on the room itself.
        </p>
        <EffectRows owner={{ node_id: nodeId }} />
      </details>

      {error && <p className="text-xs text-grave">{error}</p>}
    </div>
  )
}
