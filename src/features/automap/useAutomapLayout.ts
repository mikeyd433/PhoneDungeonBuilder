import { useEffect, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { layoutAutomap, type MapLayout } from './layout'

/**
 * elkjs layout is async and not cheap on a few hundred rooms, so it runs off the
 * render path and the previous layout stays on screen until the new one is
 * ready — the map never blanks while you edit.
 */
export function useAutomapLayout(): { layout: MapLayout | null; laying: boolean } {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const [layout, setLayout] = useState<MapLayout | null>(null)
  const [laying, setLaying] = useState(false)

  useEffect(() => {
    if (!graph || !derived) return
    let alive = true
    setLaying(true)
    void layoutAutomap(graph, derived)
      .then((next) => {
        if (alive) setLayout(next)
      })
      .finally(() => {
        if (alive) setLaying(false)
      })
    return () => {
      alive = false
    }
  }, [graph, derived])

  return { layout, laying }
}
