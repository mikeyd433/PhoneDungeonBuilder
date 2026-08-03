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
  fromNodeId,
  currentId,
  heading,
  blurb,
  wayHint,
  clearLabel,
  onPick,
  onClose,
}: {
  /** The room the caller is leaving — what "the way you came" is measured from. */
  fromNodeId: string
  /** Where it points now, so that row can say so. */
  currentId: string | null
  heading: string
  blurb: string
  /** What picking from "the way you came" means here. A door looping back and
   *  an arrival check sending the caller back are the same edge and not the
   *  same sentence. */
  wayHint: string
  /** Wording for the unwire button, or null where clearing makes no sense. */
  clearLabel: string | null
  onPick: (nodeId: string | null) => void
  onClose: () => void
}) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const trail = useDelve((s) => s.trail)
  const createLooseNode = useDelve((s) => s.createLooseNode)
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState(false)
  const [busy, setBusy] = useState(false)

  const groups = useMemo(
    () => (graph && derived ? loopTargets(graph, derived, fromNodeId, trail) : null),
    [graph, derived, fromNodeId, trail],
  )

  if (!graph || !groups) return null

  const from = graph.nodes.get(fromNodeId)
  const wire = (id: string | null) => {
    onPick(id)
    onClose()
  }

  /** Make the room and point at it, in one go. Making one and leaving it
   *  unpicked would be the same dead end one step further along. */
  const cutNew = async () => {
    const name = query.trim()
    if (!name) return
    setBusy(true)
    const id = await createLooseNode(name)
    setBusy(false)
    if (id) wire(id)
  }

  const sections: Array<{ key: string; label: string; hint: string; list: LoopCandidate[] }> = [
    {
      key: 'way',
      label: 'The way you came',
      hint: wayHint,
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
          <h3 className="text-sm text-torch">{heading}</h3>
          <button onClick={onClose} className="text-sm text-mortar underline">
            Cancel
          </button>
        </div>
        <p className="mb-3 text-xs text-cold">
          From {from?.title || from?.slug}. {blurb}
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search every room by name or slug"
          aria-label="Search rooms"
          className="mb-2 w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch"
        />

        {/* The room that does not exist yet.
            This picker only ever offered rooms already in the story, so
            anything wanting a NEW destination — a fork's second route above
            all — could not be built forwards: you had to cut a door you did
            not want, walk it, come back, and delete it. Typing a name here
            makes the room and picks it in one go. */}
        {making ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void cutNew()
                if (e.key === 'Escape') setMaking(false)
              }}
              placeholder="Name the new room"
              aria-label="Name of the new room"
              className="min-w-0 flex-1 basis-40 rounded border border-torch/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch"
            />
            <button
              type="button"
              disabled={!query.trim() || busy}
              onClick={() => void cutNew()}
              className="rounded border border-torch px-3 py-2 text-xs text-torch disabled:opacity-40"
            >
              Cut it
            </button>
            <button
              type="button"
              onClick={() => setMaking(false)}
              className="text-xs text-mortar underline"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMaking(true)}
            className="mb-3 w-full rounded border border-dashed border-mortar/60 px-3 py-2 text-left text-sm text-mortar hover:border-torch hover:text-torch"
          >
            ⛏ Cut a new room{query.trim() ? ` called “${query.trim()}”` : ''}
          </button>
        )}

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
                          c.id === currentId
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
                        {c.id === currentId && (
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

        {currentId && clearLabel && (
          <button
            onClick={() => wire(null)}
            className="w-full rounded border border-grave/60 px-3 py-2 text-sm text-grave"
          >
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  )
}
