import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export interface Peer {
  userId: string
  email: string
  nodeId: string | null
}

/**
 * F9.5 — soft edit locks: "Dan is in this room".
 *
 * Supabase Realtime presence, which is ephemeral by design and needs no table.
 * This is a *soft* lock on purpose: it tells you someone is here, it does not
 * stop you editing. §9 settles on last-write-wins plus soft locks as sufficient
 * for a group this size.
 *
 * The subscription is keyed on the story alone, and moving between rooms only
 * re-tracks. Re-subscribing per room would tear the channel down and rebuild it
 * on every step, making everyone flicker out of the roster each time anyone
 * walked through a door.
 */
export function usePresence(storyId: string | undefined, nodeId: string | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const meRef = useRef<{ id: string; email: string } | null>(null)
  // Read inside the subscribe callback without making it a dependency.
  const nodeRef = useRef(nodeId)
  nodeRef.current = nodeId

  useEffect(() => {
    if (!storyId || !supabaseConfigured) return
    let cancelled = false

    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user || cancelled) return
      meRef.current = { id: user.id, email: user.email ?? 'someone' }

      const channel = supabase.channel(`story:${storyId}`, {
        config: { presence: { key: user.id } },
      })
      channelRef.current = channel

      channel
        .on('presence', { event: 'sync' }, () => {
          const raw = channel.presenceState<{ email: string; nodeId: string | null }>()
          const next: Peer[] = []
          for (const [userId, entries] of Object.entries(raw)) {
            if (userId === user.id) continue // you are not your own peer
            const latest = entries[entries.length - 1]
            if (latest) next.push({ userId, email: latest.email, nodeId: latest.nodeId })
          }
          setPeers(next)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void channel.track({ email: meRef.current!.email, nodeId: nodeRef.current })
          }
        })
    })

    return () => {
      cancelled = true
      const channel = channelRef.current
      channelRef.current = null
      setPeers([])
      if (channel) void supabase.removeChannel(channel)
    }
  }, [storyId])

  // Moving rooms updates the tracked payload on the existing channel.
  useEffect(() => {
    const channel = channelRef.current
    if (!channel || !meRef.current) return
    void channel.track({ email: meRef.current.email, nodeId })
  }, [nodeId])

  return peers
}
