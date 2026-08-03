import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { collapseCandidates, titlesToTidy, type TitleFix } from '@/features/room/tidy'
import { canWrite } from '@/types/domain'

/**
 * Cleaning up after the import, in two passes.
 *
 * A Brainstorm export has no concept of a room: every node became one, and its
 * text became that room's title. So half the story is named with a whole
 * sentence — and those names are now the biggest thing on the map and on every
 * door plate — while plenty of the "rooms" were never places at all, but
 * actions taken on the way through.
 *
 * Nothing here happens on its own. Every change is shown, editable, and applied
 * one at a time or in a batch you chose: a wrong guess applied to 77 rooms at
 * once is much harder to undo than to avoid.
 */
export default function Tidy() {
  const { storyId } = useParams<{ storyId: string }>()
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const role = useDelve((s) => s.role)
  const loadStory = useDelve((s) => s.loadStory)
  const updateNode = useDelve((s) => s.updateNode)
  const collapseRoom = useDelve((s) => s.collapseRoom)

  const [tab, setTab] = useState<'titles' | 'rooms'>('titles')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  /** Rows the author has dealt with or waved away, so the list stops offering
   *  them without the whole page reshuffling under a scroll position. */
  const [settled, setSettled] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [keepText, setKeepText] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (storyId && graph?.story.id !== storyId) void loadStory(storyId)
  }, [storyId, graph?.story.id, loadStory])

  const titles = useMemo(() => (graph ? titlesToTidy(graph) : []), [graph])
  const rooms = useMemo(
    () => (graph && derived ? collapseCandidates(graph, derived) : []),
    [graph, derived],
  )

  if (!graph) return <p className="p-6 text-mortar">Lighting a torch…</p>
  const editable = canWrite(role)

  const openTitles = titles.filter((t) => !settled.has(t.nodeId))
  const openRooms = rooms.filter((r) => !settled.has(r.nodeId))

  const nameOf = (fix: TitleFix) => (edits[fix.nodeId] ?? fix.suggestion).trim()
  const rescuing = (fix: TitleFix) =>
    fix.narration !== null && (keepText[fix.nodeId] ?? true)

  const applyTitle = async (fix: TitleFix) => {
    const title = nameOf(fix)
    if (!title) return
    // The old title is script sitting in the wrong column, so it goes into the
    // narration rather than being thrown away — unless the narration already
    // says it, which the importer made common enough to be worth checking.
    await updateNode(fix.nodeId, {
      title,
      ...(rescuing(fix) ? { narration: fix.narration! } : {}),
    })
    setSettled((s) => new Set(s).add(fix.nodeId))
  }

  const applyAllTitles = async () => {
    if (!window.confirm(`Rename ${openTitles.length} rooms to the names shown?`)) return
    setBusy(true)
    let done = 0
    for (const fix of openTitles) {
      try {
        await applyTitle(fix)
        done += 1
      } catch {
        // Keep going: one rejected write should not strand the other 70.
      }
    }
    setBusy(false)
    setNote(`Renamed ${done} of ${openTitles.length}.`)
  }

  const collapsePicked = async () => {
    const list = openRooms.filter((r) => picked.has(r.nodeId))
    if (list.length === 0) return
    if (
      !window.confirm(
        `Splice ${list.length} room${list.length === 1 ? '' : 's'} out and join what is either side?` +
          `\n\nEach one's doors are repointed at where it led. Undo puts them back one at a time.`,
      )
    )
      return
    setBusy(true)
    let done = 0
    for (const candidate of list) {
      // Re-planned inside the store as it goes: collapsing one changes the
      // shape around the next, and a plan made before the batch started could
      // be describing a graph that no longer exists.
      if (await collapseRoom(candidate.nodeId)) done += 1
      setSettled((s) => new Set(s).add(candidate.nodeId))
    }
    setBusy(false)
    setPicked(new Set())
    setNote(`Collapsed ${done} of ${list.length}.`)
  }

  const tabClass = (which: typeof tab) =>
    [
      'rounded border px-3 py-2 text-sm',
      tab === which ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
    ].join(' ')

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to={`/story/${storyId}`} className="text-sm text-mortar underline">
          ◄ Back to the dungeon
        </Link>
        <h1 className="font-carved uppercase tracking-[0.12em] text-torch">Tidy up</h1>
      </header>

      <p className="mb-4 text-xs text-cold">
        The import made a room out of every node in the source file and used its text as the name.
        Nothing on this page happens on its own — every change is shown first, and editable.
      </p>

      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab('titles')} className={tabClass('titles')}>
          Names ({openTitles.length})
        </button>
        <button onClick={() => setTab('rooms')} className={tabClass('rooms')}>
          Rooms that were actions ({openRooms.length})
        </button>
      </div>

      {note && <p className="mb-3 text-xs text-torch">{note}</p>}
      {!editable && (
        <p className="mb-4 rounded border border-cold/60 bg-cold/10 p-3 text-xs">
          Your role is read-only.
        </p>
      )}

      {tab === 'titles' &&
        (openTitles.length === 0 ? (
          <p className="text-sm text-torch">Every room has a name that reads like one.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <button
                disabled={!editable || busy}
                onClick={() => void applyAllTitles()}
                className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
              >
                Accept all {openTitles.length}
              </button>
              <span className="text-xs text-cold">
                Or take them one at a time — the suggestion is only a starting point.
              </span>
            </div>

            <ul className="flex flex-col gap-2">
              {openTitles.map((fix) => (
                <li key={fix.nodeId} className="rounded border border-mortar/30 p-3">
                  <p className="mb-2 text-xs text-cold">
                    <span className="font-carved text-mortar">{fix.slug}</span> is called{' '}
                    <span className="italic">“{fix.was}”</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={edits[fix.nodeId] ?? fix.suggestion}
                      onChange={(e) => setEdits((d) => ({ ...d, [fix.nodeId]: e.target.value }))}
                      aria-label={`New name for ${fix.slug}`}
                      className="min-w-0 flex-1 basis-48 rounded border border-mortar/60 bg-stone px-3 py-2 font-carved outline-none focus:border-torch"
                    />
                    <button
                      disabled={!editable || busy || !nameOf(fix)}
                      onClick={() => void applyTitle(fix)}
                      className="rounded border border-torch px-3 py-2 text-xs text-torch disabled:opacity-40"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => setSettled((s) => new Set(s).add(fix.nodeId))}
                      className="rounded border border-mortar/60 px-3 py-2 text-xs text-mortar"
                    >
                      Leave it
                    </button>
                  </div>
                  {fix.narration !== null && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-cold">
                      <input
                        type="checkbox"
                        checked={keepText[fix.nodeId] ?? true}
                        onChange={(e) =>
                          setKeepText((d) => ({ ...d, [fix.nodeId]: e.target.checked }))
                        }
                        className="mt-0.5 accent-torch"
                      />
                      <span>
                        Keep the old name as script — it goes to the top of this room&apos;s
                        narration, where a caller would actually hear it.
                      </span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </>
        ))}

      {tab === 'rooms' &&
        (openRooms.length === 0 ? (
          <p className="text-sm text-torch">
            Nothing here looks like an action pretending to be a place.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-cold">
              One way in, one way out, almost nothing written, and named for something you{' '}
              <em>do</em>. Collapsing splices the room out and joins the two either side. Rooms
              carrying dialogue, items, gates or a fight are never offered here.
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  setPicked(
                    picked.size === openRooms.length
                      ? new Set()
                      : new Set(openRooms.map((r) => r.nodeId)),
                  )
                }
                className="rounded border border-mortar/60 px-3 py-2 text-xs text-mortar"
              >
                {picked.size === openRooms.length ? 'Select none' : `Select all ${openRooms.length}`}
              </button>
              <button
                disabled={!editable || busy || picked.size === 0}
                onClick={() => void collapsePicked()}
                className="rounded border border-torch px-3 py-2 text-xs text-torch disabled:opacity-40"
              >
                Collapse {picked.size || ''}
              </button>
            </div>

            <ul className="flex flex-col gap-1">
              {openRooms.map((c) => (
                <li key={c.nodeId} className="rounded border border-mortar/30 p-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={picked.has(c.nodeId)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const next = new Set(p)
                          if (e.target.checked) next.add(c.nodeId)
                          else next.delete(c.nodeId)
                          return next
                        })
                      }
                      className="mt-1 accent-torch"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{c.title}</span>
                      <span className="block text-xs text-cold">{c.because}</span>
                      {c.plan.labelsFilled > 0 && (
                        <span className="block text-xs text-mortar">
                          {c.plan.labelsFilled} unlabelled door
                          {c.plan.labelsFilled === 1 ? '' : 's'} will inherit this name.
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ))}
    </main>
  )
}
