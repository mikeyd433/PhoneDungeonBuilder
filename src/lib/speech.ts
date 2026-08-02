/**
 * F2.7 — estimated spoken duration from word count, warning over 15 seconds.
 *
 * 150 words/minute is the usual figure for clear narration; IVR prompts are read
 * a little slower than audiobook pace, and digits are read slower still. The
 * estimate only has to be good enough to catch a room that has quietly grown
 * into a monologue, so precision beyond ±1s would be false comfort.
 */
const WORDS_PER_MINUTE = 150
const WORDS_PER_SECOND = WORDS_PER_MINUTE / 60

/** Spec §4.1 / F2.7: a caller's patience on a phone tree. */
export const LONG_NARRATION_SECONDS = 15

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function estimateSeconds(text: string): number {
  const words = countWords(text)
  if (words === 0) return 0
  // Digits are spoken one-by-one ("press one"), so a run of them takes longer
  // than its word count suggests.
  const digitRuns = (text.match(/\d/g) ?? []).length
  const seconds = words / WORDS_PER_SECOND + digitRuns * 0.2
  return Math.round(seconds * 10) / 10
}

export function isLongNarration(text: string): boolean {
  return estimateSeconds(text) > LONG_NARRATION_SECONDS
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}
