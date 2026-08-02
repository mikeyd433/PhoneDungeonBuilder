import { solve, type SolverInput } from './solver'

/**
 * §7 — run the solver in a Web Worker so the UI never blocks.
 *
 * Each message carries a `token`; the main thread ignores results whose token
 * isn't the latest request. Without that, a slow solve started before an edit
 * can land after a fast one started later and overwrite fresher results.
 */
self.onmessage = (e: MessageEvent<{ token: number; input: SolverInput }>) => {
  const { token, input } = e.data
  try {
    self.postMessage({ token, result: solve(input) })
  } catch (err) {
    self.postMessage({
      token,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
