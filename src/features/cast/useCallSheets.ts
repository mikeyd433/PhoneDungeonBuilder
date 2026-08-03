import { useMemo } from 'react'
import { useDelve } from '@/features/graph/store'
import { callSheets, type CallSheet } from './callSheet'

/** Sheets keyed by actor, for a page that already lists actors. */
export function useCallSheets(): Map<string, CallSheet> {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  return useMemo(() => {
    if (!graph || !derived) return new Map()
    return new Map(callSheets(graph, derived).map((s) => [s.actor ?? ' unassigned', s]))
  }, [graph, derived])
}
