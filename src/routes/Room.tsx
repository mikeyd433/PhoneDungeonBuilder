import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { buildRoomView, type ExitView } from '@/features/room/roomModel'
import RoomStage from '@/features/room/RoomStage'
import EditorSheet from '@/features/room/EditorSheet'

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
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (storyId) void loadStory(storyId)
  }, [storyId, loadStory])

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
      <header className="flex items-center justify-between border-b border-mortar/40 px-4 py-3 text-sm">
        <Link to="/" className="text-mortar underline">
          ◄ {graph.story.title}
        </Link>
        <span className="font-paper text-torch">{view.node.slug}</span>
        <nav className="flex gap-3">
          <button
            onClick={() => void undo()}
            disabled={undoStack.length === 0}
            title={undoStack[undoStack.length - 1]?.label}
            className="text-mortar underline disabled:opacity-40"
          >
            Undo
          </button>
          <Link to={`/story/${storyId}/ledger`} className="text-mortar underline">
            Ledger
          </Link>
        </nav>
      </header>

      {(view.isOrphan || view.isUnreachable || view.endingWithExits) && (
        <p className="border-b border-grave/40 bg-grave/10 px-4 py-2 text-xs">
          {view.isUnreachable && 'No path from the entrance reaches this room. '}
          {view.isOrphan && 'Nothing leads here. '}
          {view.endingWithExits && 'This is an ending, so its exits will never be offered.'}
        </p>
      )}

      <RoomStage view={view} onEnter={onEnter} onChisel={onChisel} onRetreat={retreat} />

      <footer className="flex gap-3 border-t border-mortar/40 p-4">
        <button
          onClick={() => setEditing((v) => !v)}
          className="flex-1 rounded bg-torch px-4 py-3 font-carved uppercase tracking-[0.12em] text-depth"
        >
          ✎ Edit
        </button>
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

      {editing && <EditorSheet nodeId={currentNodeId} onClose={() => setEditing(false)} />}
    </main>
  )
}
