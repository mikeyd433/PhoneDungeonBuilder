import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { audioTargets } from '@/features/audio/targets'
import { inStoryOrder, progressOf, roomOf } from '@/features/audio/queue'
import { useTakeWriter } from '@/features/audio/useTakeWriter'
import { useHoldToRecord } from '@/features/audio/useHoldToRecord'
import { measureDuration, RecorderSession, recordingSupported } from '@/features/audio/recorder'
import { publicAudioUrl } from '@/features/audio/storage'
import { estimateSeconds, formatDuration } from '@/lib/speech'
import { canRecord } from '@/types/domain'

/**
 * One slot at a time, in the order the story is read.
 *
 * 139 rooms and nothing recorded is not a job you do by navigating to each room
 * and opening a sheet — it is 139 round trips through the same four taps. This
 * is the same list the manifest and the bulk importer read
 * (`features/audio/targets.ts`), turned into a queue: what to say, who says it,
 * hold to record, and it moves on by itself.
 *
 * It never skips ahead on its own past something you have recorded, and it
 * never hides the ones already done — being able to go back and hear a take is
 * most of what makes a long session bearable.
 */
export default function Record() {
  const { storyId } = useParams<{ storyId: string }>()
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const role = useDelve((s) => s.role)
  const loadStory = useDelve((s) => s.loadStory)
  const { save, clear } = useTakeWriter()

  const [at, setAt] = useState(0)
  const [onlyMissing, setOnlyMissing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<RecorderSession | null>(null)

  useEffect(() => {
    if (storyId && graph?.story.id !== storyId) void loadStory(storyId)
  }, [storyId, graph?.story.id, loadStory])

  const all = useMemo(
    () => (graph && derived ? inStoryOrder(audioTargets(graph), graph, derived) : []),
    [graph, derived],
  )
  const progress = useMemo(() => progressOf(all), [all])

  /**
   * The queue you are working through.
   *
   * Frozen while "only what's missing" is on, and deliberately so: recomputing
   * it after every take would delete the row under your finger the instant you
   * finished it, and the next one would jump up to meet you. The list holds
   * still; the ticks appear on it.
   */
  const [frozen, setFrozen] = useState<string[] | null>(null)
  useEffect(() => {
    if (!onlyMissing) return setFrozen(null)
    setFrozen(all.filter((t) => !t.currentPath).map((t) => t.key))
    setAt(0)
    // Rebuild only when the filter is switched on, never on every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyMissing, graph?.story.id])

  const queue = useMemo(() => {
    if (!frozen) return all
    const byKey = new Map(all.map((t) => [t.key, t]))
    return frozen.map((k) => byKey.get(k)).filter((t): t is (typeof all)[number] => Boolean(t))
  }, [all, frozen])

  const target = queue[at] ?? null
  const room = graph && target ? roomOf(graph, target) : null
  const node = room && graph ? graph.nodes.get(room) : null

  const step = (by: number) => {
    setError(null)
    setAt((i) => Math.min(queue.length - 1, Math.max(0, i + by)))
  }

  const store = async (blob: Blob) => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await save(target, blob)
      // Straight on: the whole point is not stopping between takes.
      setAt((i) => Math.min(queue.length - 1, i + 1))
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
      const { blob, durationMs } = await s.stop()
      await measureDuration(blob, durationMs)
      await store(blob)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const hold = useHoldToRecord(start, stop)

  // Every hook above this line, unconditionally.
  if (!graph) return <p className="p-6 text-mortar">Lighting a torch…</p>
  const editable = canRecord(role)

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link to={`/story/${storyId}`} className="text-sm text-mortar underline">
          ◄ Back to the dungeon
        </Link>
        <div className="flex items-center gap-3 text-xs">
          <Link to={`/story/${storyId}/audio`} className="text-mortar underline">
            Import a folder
          </Link>
          <label className="flex items-center gap-1 text-mortar">
            <input
              type="checkbox"
              checked={onlyMissing}
              onChange={(e) => setOnlyMissing(e.target.checked)}
              className="accent-torch"
            />
            only what&apos;s missing
          </label>
        </div>
      </header>

      {/* How far through the whole story, not just this queue — the number that
          says whether the project is nearly done. */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between text-xs text-mortar">
          <span>
            {progress.done} of {progress.total} recorded
            {progress.recordedMs > 0 && ` · ${formatDuration(progress.recordedMs)} of audio`}
          </span>
          <span>{Math.round((progress.done / Math.max(1, progress.total)) * 100)}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded bg-mortar/25">
          <div
            className="h-full rounded bg-torch transition-all"
            style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
          />
        </div>
      </div>

      {!editable && (
        <p className="mb-4 rounded border border-cold/60 bg-cold/10 p-3 text-xs">
          Your role cannot add recordings.
        </p>
      )}

      {!target ? (
        <div className="rounded border border-torch/60 p-6 text-center">
          <p className="text-torch">
            {progress.total === 0
              ? 'Nothing to record yet — write a room first.'
              : 'Everything has a take. The whole story is recorded.'}
          </p>
          <Link
            to={`/story/${storyId}/export`}
            className="mt-3 inline-block rounded border border-mortar px-4 py-2 text-sm"
          >
            Go to export
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col rounded border border-mortar/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="text-mortar">
                {at + 1} of {queue.length} in this queue · {target.kind}
              </span>
              <span className="text-mortar">~{estimateSeconds(target.text)}s to read</span>
            </div>

            <p className="mt-1 text-sm text-torch">{target.label}</p>
            {node && (
              <Link
                to={`/story/${storyId}`}
                onClick={() => useDelve.getState().walkTo(node.id)}
                className="text-xs text-mortar underline"
              >
                go to {node.title || node.slug}
              </Link>
            )}

            {/* The script, given the room it deserves — this is the thing being
                read aloud, so it is the biggest thing on the screen. */}
            <p className="my-4 whitespace-pre-wrap font-voice text-xl leading-relaxed">
              {target.text.trim() || (
                <span className="text-cold">
                  Nothing written for this slot. Recording it would be a take of nothing.
                </span>
              )}
            </p>

            {/* What to call the file, in case this take is being made elsewhere. */}
            <p className="text-xs text-cold">
              file name: <span className="font-carved text-mortar">{target.file}</span>
            </p>

            {target.currentPath ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <audio
                  controls
                  preload="none"
                  src={publicAudioUrl(target.currentPath)}
                  className="h-8 min-w-0 flex-1"
                />
                <span className="text-xs text-mortar">
                  {target.currentDurationMs ? formatDuration(target.currentDurationMs) : ''}
                </span>
                <button
                  disabled={!editable || busy}
                  onClick={async () => {
                    if (!window.confirm('Delete this take? It becomes silence on the phone.')) return
                    setBusy(true)
                    try {
                      await clear(target)
                    } finally {
                      setBusy(false)
                    }
                  }}
                  className="rounded border border-grave/60 px-2 py-1 text-xs text-grave disabled:opacity-40"
                >
                  Delete take
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-grave">No take — silence on the phone.</p>
            )}

            {error && <p className="mt-2 text-xs text-grave">{error}</p>}
          </div>

          {/* The controls sit at the bottom of the screen wherever the script
              ends — a thumb does not move between takes. */}
          <div className="flex-1" />

          <div className="mt-3 flex items-stretch gap-2">
            <button
              onClick={() => step(-1)}
              disabled={at === 0}
              aria-label="Previous"
              className="rounded border border-mortar/60 px-4 text-mortar disabled:opacity-30"
            >
              ◄
            </button>

            {recordingSupported() ? (
              <button
                {...hold.handlers}
                disabled={!editable || busy}
                className={[
                  'flex-1 touch-none rounded border-2 py-4 font-carved uppercase tracking-[0.12em]',
                  hold.recording ? 'border-grave text-grave' : 'border-torch text-torch',
                  busy ? 'opacity-50' : '',
                ].join(' ')}
              >
                {busy ? 'saving…' : hold.recording ? '● release to keep' : '● hold to record'}
              </button>
            ) : (
              <span className="flex-1 py-4 text-center text-xs text-cold">
                No microphone here — upload instead.
              </span>
            )}

            <label className="flex cursor-pointer items-center rounded border border-mortar/60 px-3 text-xs text-mortar">
              upload
              <input
                type="file"
                accept="audio/*"
                disabled={!editable || busy}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) await store(file)
                }}
              />
            </label>

            <button
              onClick={() => step(1)}
              disabled={at >= queue.length - 1}
              aria-label="Skip"
              className="rounded border border-mortar/60 px-4 text-mortar disabled:opacity-30"
            >
              ►
            </button>
          </div>

          <p className="mt-2 text-center text-xs text-cold">
            Hold the button while you read, release when you finish. It moves on by itself.
          </p>
        </>
      )}
    </main>
  )
}
