import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import Automap from '@/features/automap/Automap'
import { useAutomapLayout } from '@/features/automap/useAutomapLayout'
import { findRooms, surveyStory, type SurveyKey } from '@/features/automap/survey'

/**
 * §4.3 — the surveyor's notebook, and the one page that can answer a question
 * about the whole story at once.
 *
 * It used to say "139 rooms" and nothing else, over a map where every room was
 * the same pale rectangle. The count of rooms is the least useful fact about a
 * dungeon this size: what you come here to find out is how much is recorded,
 * what is sealed off, and where a particular room went.
 */
export default function MapScreen() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, derived, currentNodeId, loadStory, walkTo } = useDelve()
  const { layout, laying } = useAutomapLayout()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [band, setBand] = useState<SurveyKey | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  const survey = useMemo(
    () => (graph && derived ? surveyStory(graph, derived) : null),
    [graph, derived],
  )

  /**
   * What the map is being asked about. A typed search wins over a tapped
   * tally, because typing is the more specific act — and both being live at
   * once would leave you unable to tell which one an empty result came from.
   */
  const highlight = useMemo(() => {
    if (!graph) return null
    const found = findRooms(graph, query)
    if (found) return found
    return band ? (survey?.bands.find((b) => b.key === band)?.ids ?? null) : null
  }, [graph, query, band, survey])

  const asking = survey?.bands.find((b) => b.key === band)
  const selected = layout?.rooms.find((r) => r.id === selectedId) ?? null
  const node = selectedId ? graph?.nodes.get(selectedId) : null

  const go = (id: string) => {
    walkTo(id)
    navigate(`/story/${storyId}`)
  }

  return (
    <main className="flex h-[100dvh] flex-col bg-paper text-ink">
      <header className="border-b border-grid px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => navigate(`/story/${storyId}`)} className="font-paper underline">
            ◄ Back to the dungeon
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a room — by name or by what happens in it"
            aria-label="Find a room"
            className="min-w-0 flex-1 basis-64 rounded border border-grid bg-white/60 px-3 py-1.5 font-paper text-sm outline-none focus:border-ink"
          />
          <span className="font-paper text-sm opacity-70">
            {laying ? 'surveying…' : `${survey?.rooms ?? 0} rooms`}
          </span>
        </div>

        {/* The tallies, each one a way to light those rooms up. A number you
            cannot act on is decoration, and this map has no room for any. */}
        {survey && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {survey.bands
              .filter((b) => b.ids.size > 0)
              .map((b) => (
                <button
                  key={b.key}
                  onClick={() => setBand(band === b.key ? null : b.key)}
                  title={b.hint}
                  aria-pressed={band === b.key}
                  className={[
                    'rounded border px-2 py-1 font-paper text-xs',
                    band === b.key ? 'border-ink bg-ink text-paper' : 'border-grid opacity-80',
                  ].join(' ')}
                >
                  <strong>{b.ids.size}</strong> {b.ids.size === 1 ? b.one : b.label}
                </button>
              ))}
            {survey.unwrittenBranches > 0 && (
              <span className="font-paper text-xs opacity-60">
                {survey.unwrittenBranches}{' '}
                {survey.unwrittenBranches === 1 ? 'door leads' : 'doors lead'} nowhere yet
              </span>
            )}
          </div>
        )}

        {(query.trim() || asking) && (
          <p className="mt-2 font-paper text-xs opacity-70">
            {query.trim()
              ? `${highlight?.size ?? 0} ${highlight?.size === 1 ? 'room matches' : 'rooms match'} “${query.trim()}”.`
              : asking?.hint}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1">
        {layout ? (
          <Automap
            layout={layout}
            currentId={currentNodeId}
            highlight={highlight}
            selectedId={selectedId}
            // Tapping opens the room's card rather than teleporting outright.
            // On a map this size you tap while surveying far more often than
            // you tap to leave, and being yanked out of the map by a stray
            // press meant panning back to where you were every time.
            onSelect={setSelectedId}
            onTeleport={go}
          />
        ) : (
          <p className="p-6 font-paper">Unrolling the map…</p>
        )}
      </div>

      {/* The room you tapped, said in full — the thing the map could never tell
          you without walking there. */}
      {selected && (
        <div className="border-t border-grid bg-white/70 px-4 py-3 font-paper">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-base">
              {selected.title || <span className="opacity-60">{selected.slug} — unnamed</span>}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => go(selected.id)}
                className="rounded border border-ink px-3 py-1 text-sm"
              >
                Walk here
              </button>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                className="rounded border border-grid px-3 py-1 text-sm opacity-70"
              >
                ✕
              </button>
            </div>
          </div>

          <p className="mt-1 text-xs opacity-70">
            {[
              selected.title ? selected.slug : null,
              selected.depth === null ? 'sealed off' : `depth ${selected.depth}`,
              `${selected.doors} door${selected.doors === 1 ? '' : 's'}`,
              selected.looseDoors > 0 ? `${selected.looseDoors} leading nowhere` : null,
              selected.recorded ? 'recorded' : selected.isStub ? 'nothing written' : 'not recorded',
              selected.isEnding ? 'an ending' : null,
              selected.isFight ? 'a fight' : null,
              selected.isOrphan ? 'nothing leads here' : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {node?.narration.trim() && (
            <p className="mt-2 line-clamp-3 text-sm opacity-80">{node.narration.trim()}</p>
          )}
        </div>
      )}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-grid px-4 py-2 font-paper text-xs">
        <span>▮ recorded</span>
        <span>▭ written</span>
        <span className="opacity-70">┈ nothing written</span>
        <span className="text-grave">● a door leading nowhere</span>
        <span className="text-grave">✕ ending</span>
        <span className="opacity-70">┄ portal (back-edge)</span>
        <span className="text-grave">▭ sealed off</span>
      </footer>
    </main>
  )
}
