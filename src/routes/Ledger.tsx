import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { darkRooms, trapNodes, unwrittenBranches } from '@/features/graph/derived'
import type { StoryNode } from '@/types/domain'

type Tab = 'unexplored' | 'sealed' | 'dark' | 'traps' | 'all'

const TABS: Array<{ id: Tab; label: string; help: string }> = [
  { id: 'unexplored', label: 'Unexplored passages', help: 'Choices with no destination — your to-write list.' },
  { id: 'sealed', label: 'Sealed rooms', help: 'Rooms with nothing leading to them.' },
  { id: 'dark', label: 'Dark rooms', help: 'No audio yet, shallowest first — record from the entrance outward.' },
  {
    id: 'traps',
    label: 'Traps',
    help: 'Reachable rooms from which no ending can ever be reached — a caller who walks in can never finish (F4.9).',
  },
  { id: 'all', label: 'All rooms', help: 'The whole dungeon.' },
]

/**
 * §4.5 — the surveyor's notebook. Cold blue graph paper against the dungeon's
 * warm dark, so switching feels like stepping outside to check your map.
 */
export default function Ledger() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, derived, loadStory, walkTo } = useDelve()
  const [tab, setTab] = useState<Tab>('unexplored')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  const rows = useMemo(() => {
    if (!graph || !derived) return []
    const q = query.trim().toLowerCase()
    // F4.10 — full-text search across slug, title and narration.
    const matches = (text: string) => !q || text.toLowerCase().includes(q)

    if (tab === 'unexplored') {
      return unwrittenBranches(graph)
        .map((c) => {
          const from = graph.nodes.get(c.from_node_id)
          return {
            id: c.id,
            nodeId: c.from_node_id,
            primary: `${from?.slug ?? '?'} · digit ${c.digit}`,
            secondary: c.label || '(no label)',
          }
        })
        .filter((r) => matches(r.primary + r.secondary))
    }

    const nodeRows = (list: StoryNode[]) =>
      list
        .filter((n) => matches(`${n.slug} ${n.title} ${n.narration}`))
        .map((n) => ({
          id: n.id,
          nodeId: n.id,
          primary: n.slug,
          secondary:
            n.title ||
            (n.narration ? n.narration.slice(0, 80) : '(nothing written)'),
        }))

    if (tab === 'sealed') {
      return nodeRows([...graph.nodes.values()].filter((n) => derived.orphans.has(n.id)))
    }
    if (tab === 'dark') {
      return nodeRows(darkRooms(graph, derived))
    }
    if (tab === 'traps') {
      const traps = trapNodes(graph, derived)
      return nodeRows([...graph.nodes.values()].filter((n) => traps.has(n.id)))
    }
    return nodeRows([...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug)))
  }, [graph, derived, tab, query])

  if (!graph || !derived) return <p className="p-6 text-mortar">Unrolling the map…</p>

  return (
    <main className="min-h-full bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-grid px-4 py-3">
        <Link to={`/story/${storyId}`} className="font-paper underline">
          ◄ Back to the dungeon
        </Link>
        <h1 className="font-paper text-lg">{graph.story.title}</h1>
      </header>

      <div className="border-b border-grid px-4 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rooms…"
          className="w-full rounded border border-grid bg-white/60 px-3 py-2 font-paper outline-none focus:border-ink"
        />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-grid px-4 py-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'rounded border px-3 py-2 font-paper text-sm',
              tab === t.id ? 'border-ink bg-ink text-paper' : 'border-grid',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <p className="px-4 pt-3 font-paper text-sm opacity-70">
        {TABS.find((t) => t.id === tab)?.help} · {rows.length} found
      </p>

      <ul className="flex flex-col gap-2 p-4">
        {rows.length === 0 && <li className="font-paper opacity-60">Nothing here.</li>}
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              to={`/story/${storyId}`}
              onClick={() => walkTo(row.nodeId)}
              className="block rounded border border-grid bg-white/50 px-3 py-2 hover:border-ink"
            >
              <span className="font-paper font-bold">{row.primary}</span>
              <span className="block font-paper text-sm opacity-70">{row.secondary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
