import type { NodeStatus } from '@/types/domain'

/**
 * F3.4 — status advances on its own as work lands; F3.5's `approved` is the one
 * a person sets by hand.
 *
 * Only ever an upgrade. Re-recording an approved room must not quietly strip the
 * sign-off, and a room whose narration is cleared should not silently fall back
 * to `stub` while its audio still exists.
 */
export function nextStatus(
  current: NodeStatus,
  hasAudio: boolean,
  hasNarration: boolean,
): NodeStatus {
  if (current === 'approved') return 'approved'
  if (hasAudio) return 'recorded'
  if (hasNarration) return 'scripted'
  return 'stub'
}
