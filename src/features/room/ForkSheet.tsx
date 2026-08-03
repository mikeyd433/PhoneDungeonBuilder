import { useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import { describeExpression } from '@/features/state/describe'
import LoopBackSheet from './LoopBackSheet'
import type { GateExpression } from '@/types/domain'

/**
 * One key, two rooms — the check that happens on the way THROUGH.
 *
 * A room that reads two ways was the wrong tool for "press 1 goes somewhere
 * else if you have the helmet". Readings make one room wear two faces, so the
 * doors are the same rows and share their labels; what an author wants here is
 * two rooms, each with its own name, script and exits, and a fork in the
 * doorway between them.
 *
 * The fork is a gate with `divert`: the expression passes and the door goes
 * where it says, or it fails and the door goes somewhere else. That primitive
 * has been in the schema since 0001 and exported, playtested and solved the
 * whole time — it was just spelled "Require something → if they can't → send
 * them somewhere else", three levels into the Items tab, which is not where
 * anybody looks for "this door forks".
 *
 * So this sheet writes exactly that, and says it the way it happens: pressing
 * this key leads HERE, unless they are carrying something, in which case THERE.
 */
export default function ForkSheet({
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
  /** Which of the two destinations is being picked. */
  const [picking, setPicking] = useState<'main' | 'other' | null>(null)

  const choice = graph?.choices.get(choiceId)
  const gate = useMemo(
    () => (graph ? [...graph.gates.values()].find((g) => g.choice_id === choiceId) : undefined),
    [graph, choiceId],
  )

  if (!graph || !choice) return null

  const story = graph.story
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const named = vars.map((v) => ({ slug: v.slug, name: v.name }))
  const forks = gate?.fail_behavior === 'divert'
  const roomName = (id: string | null) =>
    (id && (graph.nodes.get(id)?.title || graph.nodes.get(id)?.slug)) || null

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

  /** Start forking: the door keeps where it goes, and the other route begins
   *  pointing at the same place so nothing is a dead end while you wire it. */
  const startFork = () =>
    void run(() =>
      api.upsertGate(story.id, choiceId, {
        expression: { op: 'has', var: vars[0].slug },
        fail_behavior: 'divert',
        fail_node_id: choice.to_node_id,
        consume_on_pass: false,
      }),
    )

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            Pressing {choice.digit}
            {choice.label ? ` — ${choice.label}` : ''}
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Done
          </button>
        </div>

        {!forks ? (
          <>
            <p className="mb-3 text-xs text-cold">
              This key leads to{' '}
              <span className="text-parchment">{roomName(choice.to_node_id) ?? 'nowhere yet'}</span>{' '}
              for everybody. A fork sends them to a different room depending on what they are
              carrying — two ordinary rooms, each with its own name, script and doors.
            </p>
            <button
              type="button"
              disabled={busy || vars.length === 0 || !choice.to_node_id}
              onClick={startFork}
              className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
            >
              ⑂ Make this door fork on an item
            </button>
            {vars.length === 0 && (
              <p className="mt-2 text-xs text-cold">Create an item first, on the Items tab.</p>
            )}
            {!choice.to_node_id && (
              <p className="mt-2 text-xs text-cold">
                Point this door at a room first — a fork needs somewhere to fork from.
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-cold">
              Checked as the caller goes through, before they arrive. They hear the door&apos;s
              reaction either way.
            </p>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-mortar">If they are</span>
              <select
                value={(gate.expression as { op?: string }).op === 'lacks' ? 'lacks' : 'has'}
                disabled={busy}
                onChange={(e) =>
                  void run(() =>
                    api.upsertGate(story.id, choiceId, {
                      expression: {
                        op: e.target.value as 'has' | 'lacks',
                        var: (gate.expression as { var?: string }).var ?? vars[0].slug,
                      } as GateExpression,
                    }),
                  )
                }
                className={field}
              >
                <option value="has">carrying</option>
                <option value="lacks">not carrying</option>
              </select>
              <select
                value={(gate.expression as { var?: string }).var ?? vars[0].slug}
                disabled={busy}
                onChange={(e) =>
                  void run(() =>
                    api.upsertGate(story.id, choiceId, {
                      expression: {
                        op:
                          (gate.expression as { op?: string }).op === 'lacks' ? 'lacks' : 'has',
                        var: e.target.value,
                      } as GateExpression,
                    }),
                  )
                }
                className={field}
              >
                {vars.map((v) => (
                  <option key={v.id} value={v.slug}>
                    {v.name || v.slug}
                  </option>
                ))}
              </select>
            </div>

            {/* The two routes, in the order they read. Both are ordinary rooms
                and neither is a fallback — which is why they are two rows the
                same size rather than a destination and an exception. */}
            <button
              type="button"
              onClick={() => setPicking('main')}
              className="rounded border border-torch/50 px-3 py-2 text-left text-sm hover:border-torch"
            >
              <span className="block text-xs text-mortar">
                …they go to
              </span>
              <span className="text-torch">{roomName(choice.to_node_id) ?? '— nowhere yet —'}</span>
            </button>

            <button
              type="button"
              onClick={() => setPicking('other')}
              className="rounded border border-mortar/60 px-3 py-2 text-left text-sm hover:border-torch"
            >
              <span className="block text-xs text-mortar">Otherwise they go to</span>
              <span className="text-parchment">
                {roomName(gate.fail_node_id) ?? '— nowhere yet —'}
              </span>
            </button>

            <p className="rounded border border-mortar/25 p-2 text-xs text-cold">
              Reads as: pressing {choice.digit} leads to{' '}
              {roomName(choice.to_node_id) ?? 'nowhere'} when {describeExpression(named, gate.expression)}, and to{' '}
              {roomName(gate.fail_node_id) ?? 'nowhere'} otherwise.
            </p>

            <p className="text-xs text-cold">
              Items this door gives or takes apply on the first route only — put anything the other
              route should grant on that room itself.
            </p>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Stop this door forking? Everyone will go the first way.'))
                  return
                void run(() => api.deleteGate(choiceId))
              }}
              className="self-start text-xs text-grave underline"
            >
              Remove the fork
            </button>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-grave">{error}</p>}

        {picking && (
          <LoopBackSheet
            fromNodeId={choice.from_node_id}
            currentId={picking === 'main' ? choice.to_node_id : (gate?.fail_node_id ?? null)}
            heading={
              picking === 'main'
                ? `Pressing ${choice.digit} leads to…`
                : `…and otherwise leads to…`
            }
            blurb="Two ordinary rooms, each with its own name, script and doors — the fork only decides which one they land in."
            wayHint="Sending one route back the way they came is how a check turns a door into a junction."
            clearLabel={null}
            onPick={(id) =>
              void run(() =>
                picking === 'main'
                  ? api.updateChoice(choice.id, { to_node_id: id })
                  : api.upsertGate(story.id, choiceId, { fail_node_id: id }),
              )
            }
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    </div>
  )
}
