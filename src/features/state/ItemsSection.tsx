import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { slugify } from '@/lib/slug'
import GateBuilder from './GateBuilder'
import { fromFlat, toFlat, type FlatGate } from './gateShape'
import type { Choice, Effect, EffectOperation, StateVar } from '@/types/domain'

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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const effectsFor = (predicate: (e: Effect) => boolean) =>
    [...graph.effects.values()].filter(predicate).sort((a, b) => a.sort_order - b.sort_order)

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  const EffectRows = ({ owner }: { owner: { node_id?: string; choice_id?: string } }) => {
    const rows = effectsFor((e) =>
      owner.node_id ? e.node_id === owner.node_id : e.choice_id === owner.choice_id,
    )
    return (
      <div className="flex flex-col gap-2">
        {rows.map((effect) => {
          const v = graph.stateVars.get(effect.state_var_id)
          const isCounter = v?.kind === 'counter'
          return (
            <div key={effect.id} className="flex flex-wrap items-center gap-2">
              <select
                value={effect.operation}
                onChange={(e) =>
                  void run(() =>
                    api.deleteEffect(effect.id).then(() =>
                      api.createEffect(story.id, {
                        ...owner,
                        state_var_id: effect.state_var_id,
                        operation: e.target.value as EffectOperation,
                        // grant/revoke must carry no amount; set/add must have one.
                        amount: ['set', 'add'].includes(e.target.value) ? (effect.amount ?? 1) : null,
                        sort_order: effect.sort_order,
                      }),
                    ),
                  )
                }
                className={field}
              >
                <option value="grant">give</option>
                <option value="revoke">take away</option>
                {isCounter && <option value="add">add</option>}
                {isCounter && <option value="set">set to</option>}
              </select>
              <span className="text-sm">{v?.slug ?? '?'}</span>
              {effect.amount !== null && <span className="text-sm text-mortar">{effect.amount}</span>}
              <button
                onClick={() => void run(() => api.deleteEffect(effect.id))}
                className="px-2 text-grave"
                aria-label="Remove effect"
              >
                ✕
              </button>
            </div>
          )
        })}
        {vars.length > 0 && (
          <select
            value=""
            onChange={(e) =>
              e.target.value &&
              void run(() =>
                api.createEffect(story.id, {
                  ...owner,
                  state_var_id: e.target.value,
                  operation: 'grant',
                  sort_order: rows.length,
                }),
              )
            }
            className={`${field} self-start`}
          >
            <option value="">+ add an effect…</option>
            {vars.map((v) => (
              <option key={v.id} value={v.id}>
                {v.slug}
              </option>
            ))}
          </select>
        )}
      </div>
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
          {vars.map((v: StateVar) => (
            <span
              key={v.id}
              className="rounded border border-mortar/50 px-2 py-1 text-xs"
              title={v.kind}
            >
              {v.slug}
              {v.is_consumable && ' ·used up'}
            </span>
          ))}
          {vars.length === 0 && <span className="text-xs text-cold">None yet.</span>}
        </div>
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
