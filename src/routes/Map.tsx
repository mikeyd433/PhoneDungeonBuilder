import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import Automap from '@/features/automap/Automap'
import { useAutomapLayout } from '@/features/automap/useAutomapLayout'

export default function MapScreen() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, currentNodeId, loadStory, walkTo } = useDelve()
  const { layout, laying } = useAutomapLayout()
  const navigate = useNavigate()

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  return (
    <main className="flex h-[100dvh] flex-col bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-grid px-4 py-3">
        <button onClick={() => navigate(`/story/${storyId}`)} className="font-paper underline">
          ◄ Back to the dungeon
        </button>
        <span className="font-paper text-sm opacity-70">
          {laying ? 'surveying…' : `${layout?.rooms.length ?? 0} rooms`}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {layout ? (
          <Automap
            layout={layout}
            currentId={currentNodeId}
            onTeleport={(id) => {
              // F4.3 — tap any room to teleport there in the room view.
              walkTo(id)
              navigate(`/story/${storyId}`)
            }}
          />
        ) : (
          <p className="p-6 font-paper">Unrolling the map…</p>
        )}
      </div>

      <footer className="flex flex-wrap gap-4 border-t border-grid px-4 py-2 font-paper text-xs">
        <span>▭ written</span>
        <span className="opacity-70">┈ stub</span>
        <span>◤ recorded</span>
        <span className="text-grave">✕ ending</span>
        <span className="opacity-70">┄ portal (back-edge)</span>
        <span>? unwritten branch</span>
        <span className="text-grave">▭ orphan / unreachable</span>
      </footer>
    </main>
  )
}
