import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { drain, pending, type QueuedWrite } from '@/lib/offlineQueue'
import { useDelve } from '@/features/graph/store'

/** Replay one queued row mutation against Supabase. */
async function apply(write: QueuedWrite): Promise<void> {
  const table = supabase.from(write.table)
  if (write.op === 'update' && write.rowId) {
    const { error } = await table.update(write.payload ?? {}).eq('id', write.rowId)
    if (error) throw error
    return
  }
  if (write.op === 'insert') {
    const { error } = await table.insert(write.payload ?? {})
    if (error) throw error
    return
  }
  if (write.op === 'delete' && write.rowId) {
    const { error } = await table.delete().eq('id', write.rowId)
    if (error) throw error
  }
}

/**
 * F7.4 — drain the offline queue when the connection comes back.
 *
 * Also drains on mount, because the browser may have been closed while offline
 * and `online` will never fire for writes queued in a previous session.
 */
export function useOfflineSync(): { queued: number; syncing: boolean } {
  const [queued, setQueued] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const refresh = useDelve((s) => s.refresh)

  useEffect(() => {
    let alive = true

    const count = async () => {
      const q = await pending()
      if (alive) setQueued(q.length)
    }

    const sync = async () => {
      if (!alive) return
      const before = await pending()
      if (before.length === 0) {
        setQueued(0)
        return
      }
      setSyncing(true)
      const { applied, remaining } = await drain(apply)
      if (!alive) return
      setQueued(remaining)
      setSyncing(false)
      // Re-read once, so the UI reflects what actually landed rather than the
      // optimistic local state.
      if (applied > 0) await refresh()
    }

    void sync()
    const onOnline = () => void sync()
    window.addEventListener('online', onOnline)
    const poll = window.setInterval(count, 5000)

    return () => {
      alive = false
      window.removeEventListener('online', onOnline)
      window.clearInterval(poll)
    }
  }, [refresh])

  return { queued, syncing }
}
