import { useRef, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { canRecord } from '@/types/domain'
import { formatDuration } from '@/lib/speech'
import { measureDuration, RecorderSession, recordingSupported } from './recorder'
import { IVR_EXT, IVR_MIME, toIvrWav } from './ivrWav'
import { useHoldToRecord } from './useHoldToRecord'
import { audioPath, publicAudioUrl, removeAudio, uploadAudio } from './storage'
import { errorText } from '@/lib/errorText'

/**
 * One take, for anything smaller than a room.
 *
 * A fight round and a gate's refusal are both lines somebody reads aloud, and
 * since nothing in the exported flow is spoken by Twilio, both need a file or
 * they are silence on the phone. Deliberately smaller than the room's
 * AudioPanel: no waveform, no approval, no status. Those decisions belong to a
 * whole scene, not a fragment of one.
 */
export default function TakeRecorder({
  name,
  path,
  durationMs,
  onSaved,
}: {
  /** Used to name the uploaded file, so the bucket stays legible by hand. */
  name: string
  path: string | null
  durationMs: number | null
  /** null clears the take. */
  onSaved: (path: string | null, durationMs: number | null) => Promise<void> | void
}) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<RecorderSession | null>(null)


  const save = async (blob: Blob, _mimeType: string, ms: number) => {
    if (!graph) return
    setBusy(true)
    try {
      const previous = path
      // Converted before it leaves the browser. MediaRecorder gives webm or
      // m4a, and Twilio's <Play> accepts neither — uploading the raw take
      // means silence on the phone. See features/audio/ivrWav.ts.
      const wav = await toIvrWav(blob)
      const next = audioPath(graph.story.id, name, IVR_EXT)
      await uploadAudio(next, wav.blob, IVR_MIME)
      await onSaved(next, wav.durationMs || ms)
      if (previous) await removeAudio(previous)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** Deleting the take, not replacing it: the slot goes back to silent, and
   *  the file is removed so nothing is left paying for storage. */
  const clear = async () => {
    if (!path) return
    if (!window.confirm('Delete this take? The slot goes back to silent on the phone.')) return
    setBusy(true)
    try {
      await onSaved(null, null)
      await removeAudio(path)
    } catch (e) {
      setError(errorText(e))
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
      const { blob, mimeType, durationMs: measured } = await s.stop()
      await save(blob, mimeType, await measureDuration(blob, measured))
    } catch (e) {
      setError(errorText(e))
    }
  }

  const hold = useHoldToRecord(start, stop)
  const recording = hold.recording

  // Every hook above this line, unconditionally — the guard comes after.
  if (!graph || !canRecord(role)) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {recordingSupported() && (
        <button
          {...hold.handlers}
          disabled={busy}
          title="Hold to record"
          className={[
            'touch-none rounded border px-2 py-1',
            recording ? 'border-grave text-grave' : 'border-mortar/60 text-mortar',
            busy ? 'opacity-50' : '',
          ].join(' ')}
        >
          {recording ? '● release' : '● hold'}
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

      {path ? (
        <>
          <audio controls preload="none" src={publicAudioUrl(path)} className="h-7 max-w-[10rem]" />
          <button
            onClick={() => void clear()}
            disabled={busy}
            title="Delete this take"
            className="rounded border border-grave/60 px-2 py-1 text-grave disabled:opacity-40"
          >
            ✕ clear
          </button>
        </>
      ) : (
        /* Not a gentle "no take": with no text-to-speech fallback this is a
           silence the caller will actually hear. */
        <span className="text-grave">no take — silent on the phone</span>
      )}
      {durationMs && <span className="text-mortar">{formatDuration(durationMs)}</span>}
      {error && <span className="text-grave">{error}</span>}
    </div>
  )
}
