import { useEffect, useRef, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { toSolverInput } from './toSolverInput'
import type { SolverResult } from './solver'

/** §7 — debounced ~400ms after edits, so typing never triggers a solve per key. */
const DEBOUNCE_MS = 400

export function useSolver(): { result: SolverResult | null; solving: boolean } {
  const graph = useDelve((s) => s.graph)
  const [result, setResult] = useState<SolverResult | null>(null)
  const [solving, setSolving] = useState(false)
  const worker = useRef<Worker | null>(null)
  const token = useRef(0)

  useEffect(() => {
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = (e: MessageEvent<{ token: number; result?: SolverResult }>) => {
      // Drop stale answers: a slow solve started before an edit must not
      // overwrite a fast one started after it.
      if (e.data.token !== token.current) return
      if (e.data.result) setResult(e.data.result)
      setSolving(false)
    }
    return () => {
      w.terminate()
      worker.current = null
    }
  }, [])

  useEffect(() => {
    if (!graph) return
    const t = window.setTimeout(() => {
      const next = ++token.current
      setSolving(true)
      worker.current?.postMessage({ token: next, input: toSolverInput(graph) })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [graph])

  return { result, solving }
}
