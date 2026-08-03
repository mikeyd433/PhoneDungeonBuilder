import { useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { loopTargets, matchCandidates, type LoopCandidate } from './loopBack'

/**
 * Send a door back to a room that already exists.
 *
 * The destination picker was every room in the story, alphabetically. At 139
 * rooms that is a list nobody can find anything in — and what authors want
 * from it is narrow: send this door BACK, to the hub they keep returning to,
 * or to somewhere they just walked through.
 *
 * So the way you came comes first, then where you have been, then everything
 * else behind the search box. The operation is the same in all three — it only
 * sets `to_node_id` — but the first two are the ones that make a loop, and a
 * loop is what draws as a stairwell rather than a door (F1.6).
 */
export default function LoopBackSheet({
  choiceId,
  onClose,
}: {
  choiceId: string
  onClose: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const trail = useDelve((s) => s.trail)
  const updateChoice = useDelve((s) => s.updateChoice)
  const [query, setQuery] = useState('')

  const choice = graph?.choices.get(choiceId)
  const groups = useMemo(
    () => (graph && derived && choice ? loopTargets(graph, derived, choice.from_node_id, trail) : null),
    [graph, derived, choice, trail],
  )

  if (!graph || !choice || !groups) return null

  const from = graph.nodes.get(choice.from_node_id)
  const wire = (id: string | null) => {
    void updateChoice(choice.id, { to_node_id: id })
    onClose()
  }

  const sections: Array<{ key: string; label: string; hint: string; list: LoopCandidate[] }> = [
    {
      key: 'way',
      label: 'The way you came',
      hint: 'Wiring a door to one of these makes a loop — the caller can come round again.',
      list: matchCandidates(groups.wayHere, query),
    },
    {
      key: 'visited',
      label: 'Where you have been',
      hint: 'Rooms you walked through this session.',
      list: matchCandidates(groups.visited, query),
    },
    {
      key: 'rest',
      label: 'Everywhere else',
      hint: '',
      // Only once you have typed: 139 rooms under two useful lists is the
      // problem this picker exists to solve, not a section of it.
      list: query.trim() ? matchCandidates(groups.rest, query) : [],
    },
  ]

  const nothing = sections.every((s) => s.list.length === 0)

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm text-torch">
            Pressing {choice.digit}
            {choice.label ? ` — ${choice.label}` : ''} leads to…
          </h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Cancel
          </button>
        </div>
        <p className="mb-3 text-xs text-cold">
          From {from?.title || from?.slug}. Pointing a door at a room the caller has already passed
          is how a middle keeps looping while its other doors go on to an ending.
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every room by name or slug"
          aria-label="Search rooms"
          className="mb-3 w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch"
        />

        {sections.map(
          (section) =>
            section.list.length > 0 && (
              <div key={section.key} className="mb-4">
                <span className="text-xs uppercase tracking-wider text-mortar">
                  {section.label}
                </span>
                {section.hint && <p className="mb-1 text-xs text-cold">{section.hint}</p>}
                <ul className="mt-1 flex flex-col gap-1">
                  {section.list.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => wire(c.id)}
                        className={[
                          'flex w-full items-baseline gap-2 rounded border px-3 py-2 text-left text-sm',
                          c.id === choice.to_node_id
                            ? 'border-torch text-torch'
                            : 'border-mortar/40 hover:border-torch',
                        ].join(' ')}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        {c.loops && (
                          <span className="shrink-0 text-xs text-torch" title="A back-edge">
                            ↺ loops
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-mortar">
                          {c.depth === null ? 'sealed' : `depth ${c.depth}`}
                        </span>
                        {c.id === choice.to_node_id && (
                          <span className="shrink-0 text-xs">current</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}

        {nothing && (
          <p className="mb-4 text-xs text-cold">
            {query.trim()
              ? `Nothing matches “${query.trim()}”.`
              : 'This is the entrance and you have not walked anywhere yet — type to search every room.'}
          </p>
        )}

        {choice.to_node_id && (
          <button
            onClick={() => wire(null)}
            className="w-full rounded border border-grave/60 px-3 py-2 text-sm text-grave"
          >
            Unwire — leave this door bricked
          </button>
        )}
      </div>
    </div>
  )
}
