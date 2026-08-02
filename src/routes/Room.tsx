import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { buildRoomView, type ExitView } from '@/features/room/roomModel'
import RoomStage from '@/features/room/RoomStage'
import EditorSheet from '@/features/room/EditorSheet'
import Automap from '@/features/automap/Automap'
import { useAutomapLayout } from '@/features/automap/useAutomapLayout'
import SatchelPanel from '@/features/state/SatchelPanel'
import { useSolver } from '@/features/state/useSolver'
import { usePresence } from '@/features/collab/usePresence'
import { useOfflineSync } from '@/features/offline/useOfflineSync'

export default function Room() {
  const { storyId } = useParams<{ storyId: string }>()
  const {
    graph,
    derived,
    currentNodeId,
    loading,
    error,
    loadStory,
    walkTo,
    retreat,
    createChildNode,
    undo,
    clearError,
  } = useDelve()
  const undoStack = useDelve((s) => s.undoStack)
  const trailLength = useDelve((s) => s.trail.length)
  const [editing, setEditing] = useState(false)
  const [choosingRetreat, setChoosingRetreat] = useState(false)
  const { layout } = useAutomapLayout()
  const { result: solverResult, solving } = useSolver()
  const [satchelOpen, setSatchelOpen] = useState(false)
  const peers = usePresence(storyId, currentNodeId)
  const { queued, syncing } = useOfflineSync()

  // Load only when this is a story we don't already have.
  //
  // Reloading unconditionally meant every arrival at this screen reset
  // `currentNodeId` to the entrance — so F4.3's tap-a-room-to-teleport walked
  // you back to the front door a moment after it put you where you asked for,
  // and so did every trip out to the map, the ledger or the cast and back.
  // Comparing ids still reloads properly when you switch stories.
  useEffect(() => {
    if (storyId && graph?.story.id !== storyId) void loadStory(storyId)
  }, [storyId, graph?.story.id, loadStory])

  if (loading) return <p className="p-6 text-mortar">Lighting a torch…</p>
  if (!graph || !derived || !currentNodeId) {
    return (
      <main className="p-6">
        <p className="text-grave">{error ?? 'Story not found.'}</p>
        <Link to="/" className="text-sm underline">
          Back
        </Link>
      </main>
    )
  }

  const view = buildRoomView(graph, derived, currentNodeId)
  if (!view) return <p className="p-6">This room has collapsed.</p>

  const onEnter = (exit: ExitView) => exit.targetId && walkTo(exit.targetId)

  // F1.11 — cycle through rooms sharing this one's parent.
  const onCycleSibling = (direction: 1 | -1) => {
    const here = view.siblings.indexOf(currentNodeId)
    if (here === -1 || view.siblings.length < 2) return
    const next = (here + direction + view.siblings.length) % view.siblings.length
    walkTo(view.siblings[next])
  }

  // F1.12 — more than one way back means a fork in the retreat path, so ask
  // rather than guessing. One parent retreats straight away.
  const onRetreat = () => {
    if (view.retreats.length > 1 && useDelve.getState().trail.length <= 1) {
      setChoosingRetreat(true)
      return
    }
    retreat()
  }
  // Either there is a trail to walk back down, or the graph itself has a way in.
  const canRetreat = trailLength > 1 || view.retreats.length > 0

  const onChisel = async (exit: ExitView) => {
    if (exit.choiceId) {
      await createChildNode(exit.choiceId)
      return
    }
    // An empty wall slot: make the archway, then chisel through it.
    await useDelve.getState().addChoice(currentNodeId, exit.digit)
    const fresh = useDelve.getState().derived?.children.get(currentNodeId) ?? []
    const created = fresh.find((c) => c.digit === exit.digit)
    if (created) await createChildNode(created.id)
  }

  return (
    <main className="flex min-h-full flex-col">
      {/* Wraps on a phone: seven links and a room name do not fit on one 390px
          row, and the thing that lost was the room name — squeezed to a single
          letter. The nav takes its own line there and sits inline from sm up. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-mortar/40 px-4 py-3 text-sm">
        {/* Named, now that the footer also has a back button: this one leaves
            the story, that one walks back a room. */}
        <Link to="/" className="shrink-0 text-mortar underline">
          Stories
        </Link>
        <span className="min-w-0 truncate font-paper text-torch">{view.node.slug}</span>
        <nav className="flex w-full shrink-0 gap-3 overflow-x-auto sm:ml-auto sm:w-auto">
          <button
            onClick={() => void undo()}
            disabled={undoStack.length === 0}
            title={undoStack[undoStack.length - 1]?.label}
            className="text-mortar underline disabled:opacity-40"
          >
            Undo
          </button>
          <button
            onClick={() => setSatchelOpen(true)}
            title="What the caller could be carrying here"
            aria-label="Open the satchel"
            className="text-mortar"
          >
            🎒
          </button>
          <Link to={`/story/${storyId}/map`} className="text-mortar underline">
            Map
          </Link>
          <Link to={`/story/${storyId}/cast`} className="text-mortar underline">
            Cast
          </Link>
          <Link to={`/story/${storyId}/playtest`} className="text-mortar underline">
            Dial in
          </Link>
          <Link to={`/story/${storyId}/ledger`} className="text-mortar underline">
            Ledger
          </Link>
          <Link to={`/story/${storyId}/export`} className="text-mortar underline">
            Export
          </Link>
        </nav>
      </header>

      {useDelve.getState().demo && (
        <p className="border-b border-torch/40 bg-torch/10 px-4 py-2 text-xs">
          Walkthrough story — it lives in memory, so nothing you change here is saved. Every screen
          is the real one.
        </p>
      )}

      {queued > 0 && (
        <p className="border-b border-cold/50 bg-cold/10 px-4 py-2 text-xs">
          {queued} edit{queued === 1 ? '' : 's'} waiting for signal
          {syncing ? ' · syncing…' : ' · they\'ll sync when you\'re back online'}
        </p>
      )}

      {/* F9.5 — a soft lock: it tells you someone is here, it doesn't stop you. */}
      {peers.some((p) => p.nodeId === currentNodeId) && (
        <p className="border-b border-torch/40 bg-torch/10 px-4 py-2 text-xs">
          {peers
            .filter((p) => p.nodeId === currentNodeId)
            .map((p) => p.email)
            .join(', ')}{' '}
          {peers.filter((p) => p.nodeId === currentNodeId).length === 1 ? 'is' : 'are'} in this room
          too.
        </p>
      )}

      {(view.isOrphan || view.isUnreachable || view.endingWithExits) && (
        <p className="border-b border-grave/40 bg-grave/10 px-4 py-2 text-xs">
          {view.isUnreachable && 'No path from the entrance reaches this room. '}
          {view.isOrphan && 'Nothing leads here. '}
          {view.endingWithExits && 'This is an ending, so its exits will never be offered.'}
          {view.fightWithExits &&
            'This room is a fight, so its doors will never be offered — the fight decides where the caller goes.'}
        </p>
      )}

      <RoomStage
        view={view}
        onEnter={onEnter}
        onChisel={onChisel}
        onRetreat={onRetreat}
        onCycleSibling={onCycleSibling}
        onWalk={walkTo}
      />

      {/* F1.12 — the retreat chooser. */}
      {choosingRetreat && (
        <div className="fixed inset-0 z-30 flex items-end bg-depth/80 p-4">
          <div className="w-full rounded-t-2xl border-t border-mortar bg-depth p-4">
            <h3 className="mb-3 text-sm text-torch">Several ways back from here</h3>
            <ul className="flex flex-col gap-2">
              {view.retreats.map((r) => (
                <li key={r.edgeId}>
                  <button
                    onClick={() => {
                      setChoosingRetreat(false)
                      walkTo(r.fromId)
                    }}
                    className="w-full rounded border border-mortar/60 px-3 py-3 text-left hover:border-torch"
                  >
                    {r.fromTitle}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setChoosingRetreat(false)}
              className="mt-3 w-full text-sm text-mortar underline"
            >
              Stay here
            </button>
          </div>
        </div>
      )}

      <footer className="flex items-center gap-3 border-t border-mortar/40 p-4">
        {/* F1.4's retreat was swipe-right and nothing else, which is unusable
            with a mouse and undiscoverable on a phone. The swipe still works. */}
        <button
          onClick={onRetreat}
          disabled={!canRetreat}
          title={
            canRetreat ? 'Back to the room you came from' : 'Nothing leads here to go back to'
          }
          className="shrink-0 rounded border border-mortar/60 px-4 py-3 font-carved uppercase tracking-[0.12em] text-mortar disabled:opacity-40"
        >
          ◄ Back
        </button>

        <button
          onClick={() => setEditing((v) => !v)}
          className="flex-1 rounded bg-torch px-4 py-3 font-carved uppercase tracking-[0.12em] text-depth"
        >
          ✎ Edit
        </button>

        {/* F4.2 — a 120x120 minimap thumbnail; tap to expand. */}
        {layout && (
          <Link
            to={`/story/${storyId}/map`}
            aria-label="Open the automap"
            className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded border border-mortar/60"
          >
            <Automap layout={layout} currentId={currentNodeId} onTeleport={() => {}} thumbnail />
          </Link>
        )}
      </footer>

      {error && (
        <div className="fixed inset-x-4 bottom-24 z-30 rounded border border-grave bg-grave/20 p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span>{error}</span>
            <button onClick={clearError} className="underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {satchelOpen && (
        <SatchelPanel
          nodeId={currentNodeId}
          result={solverResult}
          solving={solving}
          onClose={() => setSatchelOpen(false)}
        />
      )}

      {editing && <EditorSheet nodeId={currentNodeId} onClose={() => setEditing(false)} />}
    </main>
  )
}
