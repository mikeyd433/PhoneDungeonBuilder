import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import NewItemButton from './NewItemButton'
import type { Effect, EffectOperation } from '@/types/domain'

/**
 * What one owner — a door, or a room's arrival — gives and takes.
 *
 * Lifted out of `ItemsSection`, where it was a component declared inside
 * another component's body and therefore reachable from exactly one screen.
 * The door sheet calls itself everything about one door and could not start
 * the commonest job in an item story, because the control for it was three
 * closures deep in the editor.
 *
 * Nothing about the rows changed. What changed is that there is one of them
 * rather than one per surface that wants it.
 */
export default function EffectRows({
  owner,
}: {
  owner: { node_id?: string; choice_id?: string }
}) {
  const graph = useDelve((s) => s.graph)
  const refresh = useDelve((s) => s.refresh)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!graph) return null
  const story = graph.story
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const rows = [...graph.effects.values()]
    .filter((e) => (owner.node_id ? e.node_id === owner.node_id : e.choice_id === owner.choice_id))
    .sort((a, b) => a.sort_order - b.sort_order)

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

  const grant = (varId: string, sort: number) =>
    run(() =>
      api.createEffect(story.id, {
        ...owner,
        state_var_id: varId,
        operation: 'grant',
        sort_order: sort,
      }),
    )

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  return (
    <div className="flex flex-col gap-2">
      {rows.map((effect: Effect) => {
        const v = graph.stateVars.get(effect.state_var_id)
        const isCounter = v?.kind === 'counter'
        return (
          <div key={effect.id} className="flex flex-wrap items-center gap-2">
            <select
              value={effect.operation}
              disabled={busy}
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

      <div className="flex flex-wrap items-center gap-2">
        {vars.length > 0 && (
          <select
            value=""
            disabled={busy}
            onChange={(e) => e.target.value && void grant(e.target.value, rows.length)}
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
        {/* The last dead end on the item path: a story with no items showed no
            control here at all, so the answer to "how do I give this door
            something" was an empty space. */}
        <NewItemButton
          label={vars.length === 0 ? '+ Create the first item' : '+ New item'}
          onCreated={(slug) => {
            // Read through the store rather than this closure: the item was
            // created and refreshed inside the button, so `graph` up there is
            // the render before it existed and the effect would land on `?`.
            const fresh = useDelve.getState().graph
            const made = [...(fresh?.stateVars.values() ?? [])].find((v) => v.slug === slug)
            if (made) return grant(made.id, rows.length)
          }}
        />
      </div>

      {error && <p className="text-xs text-grave">{error}</p>}
    </div>
  )
}
