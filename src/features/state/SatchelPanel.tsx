import { useDelve } from '@/features/graph/store'
import type { SolverResult } from './solver'

/**
 * §7's payoff, and F8.6.
 *
 * "Show the result in the room view. The satchel icon opens a panel: guaranteed
 * items in torch amber, possible items dimmed, impossible items struck through.
 * That's the payoff — you see the player's realistic state while writing the
 * room, not after."
 */
export default function SatchelPanel({
  nodeId,
  result,
  solving,
  onClose,
}: {
  nodeId: string
  result: SolverResult | null
  solving: boolean
  onClose: () => void
}) {
  const graph = useDelve((s) => s.graph)
  if (!graph) return null

  const row = result?.availability[nodeId]
  const vars = [...graph.stateVars.values()].sort((a, b) => a.slug.localeCompare(b.slug))
  const findingsHere = (result?.findings ?? []).filter((f) => f.nodeId === nodeId)

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-depth/80" onClick={onClose}>
      <div
        className="max-h-[75vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            Satchel {solving && <span className="text-mortar">· recalculating…</span>}
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Close
          </button>
        </div>

        {vars.length === 0 && (
          <p className="text-sm text-cold">
            No items, flags or counters yet. Add them from the story&apos;s item registry.
          </p>
        )}

        {!result && vars.length > 0 && <p className="text-sm text-mortar">Working it out…</p>}

        {result && vars.length > 0 && (
          <>
            <p className="mb-3 text-xs text-mortar">
              What a caller could be holding when they arrive here — across every path that reaches
              this room.
            </p>
            <ul className="flex flex-col gap-1">
              {vars.map((v) => {
                const state = row?.[v.slug] ?? 'impossible'
                return (
                  <li
                    key={v.id}
                    className={[
                      'flex items-center justify-between rounded px-3 py-2 text-sm',
                      state === 'guaranteed'
                        ? 'bg-torch/15 text-torch'
                        : state === 'possible'
                          ? 'text-parchment/60'
                          : 'text-cold line-through',
                    ].join(' ')}
                  >
                    <span>
                      {v.slug}
                      {v.name && <span className="ml-2 opacity-70">{v.name}</span>}
                    </span>
                    <span className="text-xs uppercase tracking-wider">
                      {state === 'guaranteed' ? 'always' : state === 'possible' ? 'maybe' : 'never'}
                    </span>
                  </li>
                )
              })}
            </ul>

            {result.stateCount[nodeId] === 0 && (
              <p className="mt-3 rounded border border-grave/50 bg-grave/10 p-2 text-xs">
                No caller can reach this room at all, so nothing can be held here.
              </p>
            )}

            {result.stateCount[nodeId] > 1 && (
              <p className="mt-3 text-xs text-mortar">
                {result.stateCount[nodeId]} distinct inventory states arrive here.
              </p>
            )}

            {findingsHere.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {findingsHere.map((f, i) => (
                  <li key={i} className="rounded border border-grave/50 bg-grave/10 p-2 text-xs">
                    {f.message}
                  </li>
                ))}
              </ul>
            )}

            {result.truncated && (
              <p className="mt-3 text-xs text-cold">
                This story has more inventory states than the solver will enumerate, so these
                answers are approximate.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
