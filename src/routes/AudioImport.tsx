import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { audioTargets, matchFile, type AudioTarget } from '@/features/audio/targets'
import { IVR_EXT, IVR_MIME, toIvrWav } from '@/features/audio/ivrWav'
import { audioPath, removeAudio, uploadAudio } from '@/features/audio/storage'
import { nextStatus } from '@/features/audio/status'
import * as api from '@/lib/api'
import { formatDuration } from '@/lib/speech'
import { canRecord } from '@/types/domain'

/**
 * Dropping a folder of finished VO into the story.
 *
 * Recording room by room inside the app is fine for a scratch pass, and no use
 * at all when the takes come back from a booth or a commissioned actor as a zip
 * of files. This matches them by name — the same names the audio manifest asks
 * for — converts each one, and writes it to the slot it belongs to.
 *
 * Nothing is written until you press the button, and what WOULD happen is shown
 * first: a file that matches nothing is named rather than skipped quietly, and
 * one that would land on top of an existing take says so.
 */

type Row = {
  file: File
  target: AudioTarget | null
  state: 'ready' | 'working' | 'done' | 'failed'
  note?: string
}

export default function AudioImport() {
  const { storyId } = useParams<{ storyId: string }>()
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const loadStory = useDelve((s) => s.loadStory)
  const updateNode = useDelve((s) => s.updateNode)
  const setLineAudio = useDelve((s) => s.setLineAudio)
  const editFightRound = useDelve((s) => s.editFightRound)
  const setItemAudio = useDelve((s) => s.setItemAudio)
  const updateChoice = useDelve((s) => s.updateChoice)
  const updateStory = useDelve((s) => s.updateStory)
  const refresh = useDelve((s) => s.refresh)

  const [rows, setRows] = useState<Row[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (storyId && graph?.story.id !== storyId) void loadStory(storyId)
  }, [storyId, graph?.story.id, loadStory])

  const targets = useMemo(() => (graph ? audioTargets(graph) : []), [graph])
  const missing = targets.filter((t) => !t.currentPath)

  if (!graph) return <p className="p-6 text-mortar">Lighting a torch…</p>

  const take = (files: FileList | null) => {
    if (!files) return
    setRows(
      [...files].map((file) => ({
        file,
        target: matchFile(targets, file.name),
        state: 'ready' as const,
      })),
    )
  }

  /** Where a matched take actually gets written. */
  const assign = async (target: AudioTarget, path: string, durationMs: number) => {
    const ref = target.ref
    switch (ref.kind) {
      case 'room': {
        const node = graph.nodes.get(ref.nodeId)
        await updateNode(ref.nodeId, {
          audio_path: path,
          audio_duration_ms: durationMs,
          status: nextStatus(node?.status ?? 'stub', true, Boolean(node?.narration)),
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
        await updateChoice(ref.choiceId, {
          audio_path: path,
          audio_duration_ms: durationMs,
        })
        return
      case 'refusal':
        // Gates have no store action of their own; the graph is re-read after
        // the run rather than patched a row at a time.
        await api.upsertGate(graph.story.id, ref.choiceId, {
          fail_audio_path: path,
          fail_audio_duration_ms: durationMs,
        })
        return
    }
  }

  const run = async () => {
    setRunning(true)
    let touchedGate = false
    for (const [i, row] of rows.entries()) {
      if (!row.target) continue
      setRows((r) => r.map((x, j) => (i === j ? { ...x, state: 'working' } : x)))
      try {
        const wav = await toIvrWav(row.file)
        const previous = row.target.currentPath
        const path = audioPath(graph.story.id, row.target.file, IVR_EXT)
        await uploadAudio(path, wav.blob, IVR_MIME)
        await assign(row.target, path, wav.durationMs)
        if (row.target.ref.kind === 'refusal') touchedGate = true
        // Only once the new take is in place, so a failure can never leave the
        // slot pointing at a file that is gone.
        if (previous) await removeAudio(previous)
        setRows((r) =>
          r.map((x, j) =>
            i === j ? { ...x, state: 'done', note: formatDuration(wav.durationMs) } : x,
          ),
        )
      } catch (e) {
        setRows((r) =>
          r.map((x, j) =>
            i === j
              ? { ...x, state: 'failed', note: e instanceof Error ? e.message : String(e) }
              : x,
          ),
        )
      }
    }
    if (touchedGate) await refresh()
    setRunning(false)
  }

  const matched = rows.filter((r) => r.target).length
  const unmatched = rows.length - matched
  const editable = canRecord(role)

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl text-torch">Import audio</h1>
        <Link to={`/story/${storyId}/export`} className="text-sm text-mortar underline">
          Export
        </Link>
      </header>

      <p className="mb-4 text-sm text-cold">
        Drop in everything at once. Files are matched by name — the names the audio manifest asks
        for — converted for the phone, and written to the slot they belong to. A take number or a{' '}
        <code>(1)</code> from a second download is ignored.
      </p>

      {!editable && (
        <p className="mb-4 rounded border border-cold/60 bg-cold/10 p-3 text-xs">
          Your role cannot add recordings.
        </p>
      )}

      <label className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded border border-dashed border-mortar/60 p-8 text-center hover:border-torch">
        <span className="text-sm">Choose audio files</span>
        <span className="text-xs text-cold">
          {missing.length} of {targets.length} slots have no take yet
        </span>
        <input
          type="file"
          accept="audio/*"
          multiple
          disabled={!editable || running}
          className="hidden"
          onChange={(e) => take(e.target.files)}
        />
      </label>

      {rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-torch">{matched} matched</span>
            {unmatched > 0 && <span className="text-grave">{unmatched} unmatched</span>}
            <button
              onClick={() => void run()}
              disabled={!editable || running || matched === 0}
              className="ml-auto rounded bg-torch px-4 py-2 font-carved uppercase tracking-[0.12em] text-depth disabled:opacity-40"
            >
              {running ? 'Importing…' : `Import ${matched}`}
            </button>
          </div>

          <ul className="flex flex-col gap-1">
            {rows.map((row, i) => (
              <li
                key={`${row.file.name}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded border border-mortar/25 p-2 text-sm"
              >
                <span className="min-w-0 flex-1 basis-48 truncate">{row.file.name}</span>
                {row.target ? (
                  <span className="min-w-0 flex-1 basis-48 truncate text-mortar">
                    → {row.target.label}
                    {/* Replacing something is worth saying before, not after. */}
                    {row.target.currentPath && row.state === 'ready' && (
                      <span className="ml-2 text-grave">replaces a take</span>
                    )}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 basis-48 text-grave">
                    nothing in this story is called that
                  </span>
                )}
                <span
                  className={[
                    'shrink-0 text-xs',
                    row.state === 'done'
                      ? 'text-torch'
                      : row.state === 'failed'
                        ? 'text-grave'
                        : 'text-mortar',
                  ].join(' ')}
                >
                  {row.state === 'working' ? '…' : (row.note ?? '')}
                  {row.state === 'done' && ' ✓'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows.length === 0 && missing.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-xs uppercase tracking-wider text-mortar">
            Still silent — name the files like this
          </h2>
          <ul className="flex flex-col gap-1 text-xs">
            {missing.slice(0, 60).map((t) => (
              <li key={t.key} className="flex flex-wrap gap-2 rounded border border-mortar/25 p-2">
                <span className="font-carved text-torch">{t.file}</span>
                <span className="min-w-0 flex-1 truncate text-cold">{t.label}</span>
                <span className="shrink-0 text-mortar">{t.kind}</span>
              </li>
            ))}
          </ul>
          {missing.length > 60 && (
            <p className="mt-2 text-xs text-cold">
              …and {missing.length - 60} more. The audio manifest on the export screen has the
              whole list.
            </p>
          )}
        </>
      )}
    </main>
  )
}
