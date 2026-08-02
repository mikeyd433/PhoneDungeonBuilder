import { useRef, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { canRecord } from '@/types/domain'
import { formatDuration } from '@/lib/speech'
import { measureDuration, RecorderSession, recordingSupported } from '@/features/audio/recorder'
import { IVR_EXT, IVR_MIME, toIvrWav } from '@/features/audio/ivrWav'
import { useHoldToRecord } from '@/features/audio/useHoldToRecord'
import { audioPath, publicAudioUrl, removeAudio, uploadAudio } from '@/features/audio/storage'
import { audioTargets } from '@/features/audio/targets'

/**
 * Record one line of a conversation.
 *
 * Deliberately smaller than the room's AudioPanel: no waveform, no approval
 * checkbox, no status. A line is a fragment, and the decisions that hang off a
 * whole scene — is this the take, is this room done — belong to the room.
 *
 * The moment ANY line here has a take, the room stops being one recording and
 * starts playing line by line. That is the switch that lets two separately
 * booked actors share a scene, and it follows the data rather than a setting,
 * so there is nothing to keep in step.
 */
export default function LineRecorder({ lineId }: { lineId: string }) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const setLineAudio = useDelve((s) => s.setLineAudio)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<RecorderSession | null>(null)

  const line = graph?.dialogue.get(lineId)

  const save = async (blob: Blob, _mimeType: string, durationMs: number) => {
    if (!graph || !line) return
    setBusy(true)
    try {
      const previous = line.audio_path
      // Converted before it leaves the browser. MediaRecorder gives webm or
      // m4a, and Twilio's <Play> accepts neither — uploading the raw take
      // means silence on the phone. See features/audio/ivrWav.ts.
      const wav = await toIvrWav(blob)
      // The one place a file is named: the manifest asks an actor for exactly
      // this name and the bulk importer matches on it, so a second spelling
      // here would be a file nothing claims.
      const stem =
        audioTargets(graph).find((t) => t.ref.kind === 'line' && t.ref.lineId === line.id)?.file ??
        `line${line.sort_order + 1}`
      const path = audioPath(graph.story.id, stem, IVR_EXT)
      await uploadAudio(path, wav.blob, IVR_MIME)
      await setLineAudio(line.id, path, wav.durationMs || durationMs)
      if (previous) await removeAudio(previous)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setError(null)
    try {
      const s = new RecorderSession()
      await s.start()
      session.current = s
    } catch {
      setError('No microphone.')
    }
  }

  const stop = async () => {
    const s = session.current
    session.current = null
    if (!s) return
    try {
      const { blob, mimeType, durationMs } = await s.stop()
      await save(blob, mimeType, await measureDuration(blob, durationMs))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** A take deleted, not replaced: the line goes back to silent. */
  const clear = async () => {
    const previous = line?.audio_path
    if (!line) return
    if (!previous) return
    if (!window.confirm('Delete this line’s take? It becomes silent on the phone.')) return
    setBusy(true)
    try {
      await setLineAudio(line.id, null, null)
      await removeAudio(previous)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const hold = useHoldToRecord(start, stop)
  const recording = hold.recording

  // Every hook above this line, unconditionally — the guards come after.
  if (!canRecord(role) || !line || !graph) return null

  return (
    <div className="flex items-center gap-2 text-xs">
      {recordingSupported() && (
        <button
          {...hold.handlers}
          disabled={busy}
          title="Hold to record this line"
          className={[
            'touch-none rounded border px-2 py-1',
            recording ? 'border-grave text-grave' : 'border-mortar/60 text-mortar',
            busy ? 'opacity-50' : '',
          ].join(' ')}
        >
          {recording ? '● release' : '● hold'}
        </button>
      )}

      {line.audio_path && (
        <button
          onClick={() => void clear()}
          disabled={busy}
          title="Delete this line's take"
          className="rounded border border-grave/60 px-2 py-1 text-grave disabled:opacity-40"
        >
          ✕
        </button>
      )}

      <label className="cursor-pointer rounded border border-mortar/60 px-2 py-1 text-mortar">
        upload
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) return
            await save(file, file.type || 'audio/mpeg', await measureDuration(file, 0))
          }}
        />
      </label>

      {line.audio_path ? (
        <audio
          controls
          preload="none"
          src={publicAudioUrl(line.audio_path)}
          className="h-7 max-w-[10rem]"
        />
      ) : (
        <span className="text-cold">no take</span>
      )}
      {line.audio_duration_ms && (
        <span className="text-mortar">{formatDuration(line.audio_duration_ms)}</span>
      )}
      {error && <span className="text-grave">{error}</span>}
    </div>
  )
}
