import { useCallback } from 'react'
import { useDelve } from '@/features/graph/store'
import { audioPath, removeAudio, uploadAudio } from '@/features/audio/storage'
import { IVR_EXT, IVR_MIME, toIvrWav } from '@/features/audio/ivrWav'
import { nextStatus } from '@/features/audio/status'
import type { AudioTarget } from '@/features/audio/targets'
import * as api from '@/lib/api'

/**
 * Putting a take where it belongs — the one path, for every screen that records.
 *
 * There are three places a take can arrive from now: held down in a room, dropped
 * in as a folder from a booth, or worked through in the recording queue. All
 * three have to do exactly the same four things, in the same order:
 *
 *   convert -> upload -> point the row at it -> only then delete the old file
 *
 * The order is the part worth guarding. Deleting first means a failed upload
 * leaves a slot pointing at nothing; and skipping the conversion means silence
 * on the phone, because MediaRecorder gives webm and Twilio's `<Play>` accepts
 * neither webm nor m4a (features/audio/ivrWav.ts).
 *
 * Every slot writes back to a different table, which is what `assign` is: the
 * one place that knows which. Three copies of that switch would be three chances
 * to forget a kind.
 */
export function useTakeWriter() {
  const graph = useDelve((s) => s.graph)
  const updateNode = useDelve((s) => s.updateNode)
  const setLineAudio = useDelve((s) => s.setLineAudio)
  const editFightRound = useDelve((s) => s.editFightRound)
  const setItemAudio = useDelve((s) => s.setItemAudio)
  const updateChoice = useDelve((s) => s.updateChoice)
  const updateStory = useDelve((s) => s.updateStory)
  const refresh = useDelve((s) => s.refresh)

  const assign = useCallback(
    async (target: AudioTarget, path: string | null, durationMs: number | null) => {
      const ref = target.ref
      switch (ref.kind) {
        case 'room': {
          const node = graph?.nodes.get(ref.nodeId)
          await updateNode(ref.nodeId, {
            audio_path: path,
            audio_duration_ms: durationMs,
            status: nextStatus(node?.status ?? 'stub', Boolean(path), Boolean(node?.narration)),
          })
          return
        }
        case 'line':
          await setLineAudio(ref.lineId, path, durationMs)
          return
        case 'fight round':
          await editFightRound(ref.roundId, { audio_path: path, audio_duration_ms: durationMs })
          return
        case 'item':
          await setItemAudio(ref.varId, path, durationMs)
          return
        case 'inventory':
          await updateStory(
            ref.slot === 'intro'
              ? { inventory_intro_audio_path: path, inventory_intro_audio_duration_ms: durationMs }
              : { inventory_empty_audio_path: path, inventory_empty_audio_duration_ms: durationMs },
          )
          return
        case 'reaction':
          await updateChoice(ref.choiceId, { audio_path: path, audio_duration_ms: durationMs })
          return
        case 'reading':
          // Same reason as a refusal: variants have no store action, so the
          // graph is re-read rather than patched a row at a time.
          await api.updateVariant(ref.variantId, {
            audio_path: path,
            audio_duration_ms: durationMs,
          })
          await refresh()
          return
        case 'refusal':
          // Gates have no store action of their own; the graph is re-read rather
          // than patched a row at a time.
          if (!graph) return
          await api.upsertGate(graph.story.id, ref.choiceId, {
            fail_audio_path: path,
            fail_audio_duration_ms: durationMs,
          })
          await refresh()
          return
      }
    },
    [graph, updateNode, setLineAudio, editFightRound, setItemAudio, updateChoice, updateStory, refresh],
  )

  /** Convert, upload, point the slot at it, then clear the file it replaced. */
  const save = useCallback(
    async (target: AudioTarget, blob: Blob): Promise<number> => {
      if (!graph) throw new Error('No story loaded.')
      const wav = await toIvrWav(blob)
      const previous = target.currentPath
      const path = audioPath(graph.story.id, target.file, IVR_EXT)
      await uploadAudio(path, wav.blob, IVR_MIME)
      await assign(target, path, wav.durationMs)
      // Last, and only on success: a slot must never point at a file that is gone.
      if (previous && previous !== path) await removeAudio(previous)
      return wav.durationMs
    },
    [graph, assign],
  )

  /** Back to silence. An accidental one-second take reads as a recorded room
   *  and plays as nothing, which is worse than never having recorded it. */
  const clear = useCallback(
    async (target: AudioTarget) => {
      const previous = target.currentPath
      await assign(target, null, null)
      if (previous) await removeAudio(previous)
    },
    [assign],
  )

  return { save, clear, assign }
}
