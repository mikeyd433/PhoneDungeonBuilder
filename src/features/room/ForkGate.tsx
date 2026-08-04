import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import { describeExpression } from '@/features/state/describe'
import LoopBackSheet from './LoopBackSheet'

/**
 * The doorway, held open at the fork.
 *
 * A door that forks goes to two rooms, and walking through it could only ever
 * take you to one of them — the pass route — so the other half of the split
 * was a room you had built and could not visit without going round by the map.
 * That is the same failing `ReactionGate` fixes for a door's reaction: what
 * lives BETWEEN two rooms has nowhere to be seen from either of them.
 *
 * So an ordinary door still walks straight through, and a forking one stops
 * and asks which caller you are. Both routes are ordinary rooms with their own
 * name, script, cast and exits; the condition only decides which one a caller
 * lands in, and it is named on the button so the choice is not two room names
 * with no reason attached.
 *
 * A route with nowhere to go yet is wired from here too, through the same
 * picker the fork sheet uses — so "fork this door into two rooms" can be
 * finished in the doorway where you noticed it needed doing.
 */
export default function ForkGate({
  choiceId,
  onWalk,
  onCancel,
}: {
  choiceId: string
  onWalk: (nodeId: string) => void
  onCancel: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const refresh = useDelve((s) => s.refresh)
  const [picking, setPicking] = useState<'main' | 'other' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choice = graph?.choices.get(choiceId)
  const gate = graph ? [...graph.gates.values()].find((g) => g.choice_id === choiceId) : undefined
  if (!graph || !choice || gate?.fail_behavior !== 'divert') return null

  const named = [...graph.stateVars.values()].map((v) => ({ slug: v.slug, name: v.name }))
  const condition = describeExpression(named, gate.expression)
  const roomOf = (id: string | null) => (id ? (graph.nodes.get(id) ?? null) : null)
  const nameOf = (id: string | null) => {
    const n = roomOf(id)
    return n ? n.title?.trim() || n.slug : null
  }

  // `describeExpression` already returns a clause — "carrying the helmet" — so
  // it stands as the heading rather than being wrapped in more words.
  const routes = [
    { key: 'main' as const, id: choice.to_node_id, when: condition },
    { key: 'other' as const, id: gate.fail_node_id, when: 'everybody else' },
  ]

  const point = async (id: string | null) => {
    setError(null)
    try {
      if (picking === 'main') await api.updateChoice(choice.id, { to_node_id: id })
      else await api.upsertGate(graph.story.id, choice.id, { fail_node_id: id })
      await refresh()
    } catch (e) {
      setError(errorText(e))
    }
    setPicking(null)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-depth/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="This door forks — which room"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-mortar bg-depth p-4"
      >
        <h3 className="text-sm text-torch">
          Pressing {choice.digit}
          {choice.label ? ` — ${choice.label}` : ''} forks
        </h3>
        <p className="mt-1 text-xs text-cold">
          One key, two rooms. On the phone the caller never chooses — the check does. Here you
          pick which of them to walk into.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {routes.map((route) => {
            const title = nameOf(route.id)
            return (
              <div key={route.key} className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-mortar">{route.when}</span>
                {route.id && title ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onWalk(route.id!)}
                      className="min-w-0 flex-1 rounded border border-torch/60 px-3 py-2 text-left text-sm text-torch hover:border-torch"
                    >
                      Walk into {title}
                    </button>
                    <button
                      onClick={() => setPicking(route.key)}
                      aria-label={`Change where the ${route.key === 'main' ? 'first' : 'second'} route leads`}
                      title="Send this route somewhere else"
                      className="shrink-0 rounded border border-mortar/60 px-3 py-2 text-xs text-mortar hover:border-torch"
                    >
                      ↺
                    </button>
                  </div>
                ) : (
                  /* Half a fork. Wired from here rather than reported, because
                     this is the moment you found out it was missing. */
                  <button
                    onClick={() => setPicking(route.key)}
                    className="rounded border border-dashed border-mortar/60 px-3 py-2 text-left text-sm text-cold hover:border-torch hover:text-torch"
                  >
                    — nowhere yet — point it at a room →
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {error && <p className="mt-2 text-xs text-grave">{error}</p>}

        <button
          onClick={onCancel}
          className="mt-4 w-full rounded border border-mortar/60 px-3 py-2 text-sm text-mortar"
        >
          Stay here
        </button>

        {picking && (
          <LoopBackSheet
            fromNodeId={choice.from_node_id}
            currentId={picking === 'main' ? choice.to_node_id : gate.fail_node_id}
            heading={
              picking === 'main'
                ? `Pressing ${choice.digit} leads to…`
                : '…and everybody else goes to…'
            }
            blurb="Two ordinary rooms, each with its own name, script and doors — the fork only decides which one they land in."
            wayHint="Sending one route back the way they came is how a check turns a door into a junction."
            clearLabel={null}
            onPick={(id) => void point(id)}
            onClose={() => setPicking(null)}
          />
        )}
      </div>
    </div>
  )
}
