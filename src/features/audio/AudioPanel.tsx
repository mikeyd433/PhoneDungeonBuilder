import { useCallback, useEffect, useRef, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { canRecord, canWrite } from '@/types/domain'
import { formatDuration } from '@/lib/speech'
import {
  computePeaks,
  extensionFor,
  measureDuration,
  RecorderSession,
  recordingSupported,
} from './recorder'
import { audioPath, downloadAudio, publicAudioUrl, removeAudio, uploadAudio } from './storage'
import Waveform from './Waveform'
import { nextStatus } from './status'

export default function AudioPanel({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const updateNode = useDelve((s) => s.updateNode)
  const node = graph?.nodes.get(nodeId)

  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<number[]>([])
  const [elapsed, setElapsed] = useState(0)
  const session = useRef<RecorderSession | null>(null)
  const tick = useRef<number | null>(null)

  const url = node?.audio_path ? publicAudioUrl(node.audio_path) : null

  // Load peaks for the existing clip so the scrubber shows the shape of the
  // take rather than an empty bar.
  useEffect(() => {
    let alive = true
    setPeaks([])
    if (!node?.audio_path) return
    void downloadAudio(node.audio_path).then(async (blob) => {
      if (!blob || !alive) return
      const p = await computePeaks(blob)
      if (alive) setPeaks(p)
    })
    return () => {
      alive = false
    }
  }, [node?.audio_path])

  // Stop the mic if this unmounts mid-take; an orphaned MediaRecorder keeps the
  // browser's recording indicator lit.
  useEffect(
    () => () => {
      session.current?.cancel()
      if (tick.current) window.clearInterval(tick.current)
    },
    [],
  )

  const save = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      if (!node || !graph) return
      setBusy('Uploading…')
      try {
        const previous = node.audio_path
        const path = audioPath(graph.story.id, node.slug, extensionFor(mimeType))
        await uploadAudio(path, blob, mimeType)
        await updateNode(node.id, {
          audio_path: path,
          audio_duration_ms: durationMs,
          status: nextStatus(node.status, true, Boolean(node.narration)),
        })
        if (previous) await removeAudio(previous)
        setPeaks(await computePeaks(blob))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [node, graph, updateNode],
  )

  async function startRecording() {
    setError(null)
    try {
      const s = new RecorderSession()
      await s.start()
      session.current = s
      setRecording(true)
      setElapsed(0)
      const began = Date.now()
      tick.current = window.setInterval(() => setElapsed(Date.now() - began), 100)
    } catch {
      setError('Microphone access was refused, so there is nothing to record with.')
    }
  }

  async function stopRecording() {
    if (tick.current) window.clearInterval(tick.current)
    const s = session.current
    session.current = null
    setRecording(false)
    if (!s) return
    try {
      const { blob, mimeType, durationMs } = await s.stop()
      const measured = await measureDuration(blob, durationMs)
      await save(blob, mimeType, measured)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onUpload(file: File) {
    setError(null)
    const durationMs = await measureDuration(file, 0)
    await save(file, file.type || 'audio/mpeg', durationMs)
  }

  if (!node) return null
  const mayRecord = canRecord(role)

  return (
    <section className="flex flex-col gap-3 border-t border-mortar/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-mortar">Audio</h3>
        <span className={node.audio_path ? 'text-xs text-torch' : 'text-xs text-cold'}>
          {node.status}
          {node.audio_duration_ms ? ` · ${formatDuration(node.audio_duration_ms)}` : ''}
        </span>
      </div>

      {url && <Waveform peaks={peaks} src={url} />}

      {!mayRecord && <p className="text-xs text-cold">Your role cannot record.</p>}

      {mayRecord && (
        <div className="flex flex-wrap items-center gap-3">
          {recordingSupported() ? (
            <button
              // Hold to record (F3.1): press and hold on touch, mouse-down on
              // desktop. Releasing anywhere ends the take, so dragging off the
              // button can't leave the mic open.
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              onPointerLeave={() => recording && void stopRecording()}
              disabled={Boolean(busy)}
              className={[
                'flex-1 rounded px-4 py-3 font-carved uppercase tracking-[0.12em]',
                recording ? 'bg-grave text-parchment' : 'bg-torch text-depth',
                busy ? 'opacity-50' : '',
              ].join(' ')}
            >
              {recording ? `● Recording ${(elapsed / 1000).toFixed(1)}s — release` : '● Hold to record'}
            </button>
          ) : (
            <p className="text-xs text-cold">
              This browser can&apos;t record; upload a file instead.
            </p>
          )}

          <label className="cursor-pointer rounded border border-mortar px-3 py-3 text-sm hover:border-torch">
            Upload
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void onUpload(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {/* F3.5 — approved is deliberately separate from recorded: a scratch take
          is "recorded", but only a person can say it is the take. */}
      {node.audio_path && canWrite(role) && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={node.status === 'approved'}
            onChange={(e) =>
              void updateNode(node.id, {
                status: e.target.checked ? 'approved' : 'recorded',
              })
            }
          />
          Approved — this is the final take
        </label>
      )}

      {busy && <p className="text-xs text-mortar">{busy}</p>}
      {error && <p className="text-xs text-grave">{error}</p>}
    </section>
  )
}
