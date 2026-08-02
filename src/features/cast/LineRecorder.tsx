import { useRef, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { canRecord } from '@/types/domain'
import { formatDuration } from '@/lib/speech'
import { measureDuration, RecorderSession, recordingSupported } from '@/features/audio/recorder'
import { IVR_EXT, IVR_MIME, toIvrWav } from '@/features/audio/ivrWav'
import { audioPath, publicAudioUrl, removeAudio, uploadAudio } from '@/features/audio/storage'

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

  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<RecorderSession | null>(null)

  const line = graph?.dialogue.get(lineId)
  if (!line || !graph) return null
  if (!canRecord(role)) return null

  const save = async (blob: Blob, _mimeType: string, durationMs: number) => {
    setBusy(true)
    try {
      const previous = line.audio_path
      // The slug carries the line's position so the bucket stays legible when
      // somebody goes looking for a file by hand.
      const node = graph.nodes.get(line.node_id)
      // Converted before it leaves the browser. MediaRecorder gives webm or
      // m4a, and Twilio's <Play> accepts neither — uploading the raw take
      // means silence on the phone. See features/audio/ivrWav.ts.
      const wav = await toIvrWav(blob)
      const path = audioPath(
        graph.story.id,
        `${node?.slug ?? 'room'}-line${line.sort_order + 1}`,
        IVR_EXT,
      )
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
      setRecording(true)
    } catch {
      setError('No microphone.')
    }
  }

  const stop = async () => {
    const s = session.current
    session.current = null
    setRecording(false)
    if (!s) return
    try {
      const { blob, mimeType, durationMs } = await s.stop()
      await save(blob, mimeType, await measureDuration(blob, durationMs))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {recordingSupported() && (
        <button
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={() => recording && void stop()}
          disabled={busy}
          title="Hold to record this line"
          className={[
            'rounded border px-2 py-1',
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
