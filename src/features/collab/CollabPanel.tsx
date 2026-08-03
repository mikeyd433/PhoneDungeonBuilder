import { useEffect, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { supabase } from '@/lib/supabase'
import * as collab from './api'
import type { Claim, NodeComment } from './api'
import { errorText } from '@/lib/errorText'

/** F9.3 comments and F9.4 claiming, for one room. */
export default function CollabPanel({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const [comments, setComments] = useState<NodeComment[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [body, setBody] = useState('')
  const [me, setMe] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const storyId = graph?.story.id

  const reload = async () => {
    if (!storyId) return
    try {
      const [c, k] = await Promise.all([collab.listComments(nodeId), collab.listClaims(storyId)])
      setComments(c)
      setClaims(k)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, storyId])

  if (!graph) return null
  const mine = claims.find((c) => c.node_id === nodeId)
  const open = comments.filter((c) => !c.resolved)

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-mortar/30 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-mortar">
          Notes &amp; claims
          {open.length > 0 && <span className="ml-2 text-torch">{open.length} open</span>}
        </span>

        {/* F9.4 — claiming turns the ledger from a to-do list into a work queue. */}
        {mine ? (
          <button
            onClick={() => void act(() => collab.release(mine.id))}
            className="text-xs underline"
          >
            {mine.user_id === me ? 'Release this room' : 'Claimed by someone else'}
          </button>
        ) : (
          <button
            onClick={() => void act(() => collab.claim(graph.story.id, { nodeId }))}
            className="rounded border border-mortar px-2 py-1 text-xs hover:border-torch"
          >
            Claim this room
          </button>
        )}
      </div>

      {mine && mine.user_id !== me && (
        <p className="rounded border border-cold/50 bg-cold/10 p-2 text-xs">
          Someone else is working on this room.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <li
            key={c.id}
            className={[
              'rounded border p-2 text-sm',
              c.resolved ? 'border-mortar/30 opacity-50' : 'border-mortar/60',
            ].join(' ')}
          >
            <p className={c.resolved ? 'line-through' : undefined}>{c.body}</p>
            <button
              onClick={() => void act(() => collab.resolveComment(c.id, !c.resolved))}
              className="mt-1 text-xs text-mortar underline"
            >
              {c.resolved ? 'Reopen' : 'Resolve'}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a note about this room…"
          className="flex-1 rounded border border-mortar/60 bg-stone px-2 py-2 text-sm"
        />
        <button
          disabled={!body.trim()}
          onClick={() =>
            void act(async () => {
              await collab.addComment(graph.story.id, nodeId, body.trim())
              setBody('')
            })
          }
          className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
        >
          Post
        </button>
      </div>

      {error && <p className="text-xs text-grave">{error}</p>}
    </div>
  )
}
