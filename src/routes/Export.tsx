import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { useAutomapLayout } from '@/features/automap/useAutomapLayout'
import { compileStory } from '@/features/export/compile'
import {
  audioManifestCsv,
  buildSheet,
  printableScript,
  storyJson,
  studioFlowJson,
} from '@/features/export/outputs'
import { publicAudioUrl } from '@/features/audio/storage'

function download(name: string, body: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Export() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, derived, loadStory } = useDelve()
  const { layout } = useAutomapLayout()
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  // The exporter needs the public prefix that Twilio will fetch from. Derive it
  // from a real signed-free public URL rather than hard-coding the host.
  const audioBase = useMemo(() => {
    const sample = publicAudioUrl('x')
    return sample.slice(0, sample.length - 1)
  }, [])

  const compiled = useMemo(
    () => (graph ? compileStory(graph, audioBase) : null),
    [graph, audioBase],
  )

  if (!graph || !compiled) return <p className="p-6 text-mortar">Preparing…</p>

  const positions = new Map(
    (layout?.rooms ?? []).map((r) => [r.id, { x: r.x * 2.5, y: r.y * 2.5 }]),
  )
  const sheet = buildSheet(graph, compiled, derived?.depth)
  const pct = Math.round((compiled.budget.total / compiled.budget.limit) * 100)

  const copy = async (label: string, text: string) => {
    await navigator.clipboard?.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <Link to={`/story/${storyId}`} className="text-sm text-mortar underline">
          ◄ Back to the dungeon
        </Link>
        <h1 className="text-xl text-torch">Export</h1>
      </header>

      {/* §6.5 — the widget budget meter, so you know where you stand while
          writing rather than at export time. */}
      <section className="mb-6 rounded border border-mortar/50 p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span>Widget budget</span>
          <span className={compiled.budget.warn ? 'text-grave' : 'text-mortar'}>
            {compiled.budget.total} / {compiled.budget.limit} ({pct}%)
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded bg-depth">
          <div
            style={{ width: `${Math.min(100, pct)}%` }}
            className={compiled.budget.warn ? 'h-full bg-grave' : 'h-full bg-torch'}
          />
        </div>
        {compiled.budget.warn && (
          <p className="mt-2 text-xs text-grave">
            Past 80% of Twilio&apos;s ceiling. Consider splitting acts into subflows, or contact
            Twilio Support to raise the limit.
          </p>
        )}
        <p className="mt-3 text-xs text-mortar">
          Longest single route ≈ {compiled.longestPathSteps} steps; one call is capped at 1,000.
          {compiled.stepCapRisk && (
            <span className="text-grave"> A long playthrough could exhaust it.</span>
          )}
        </p>
      </section>

      {compiled.warnings.length > 0 && (
        <details className="mb-6 rounded border border-grave/50 bg-grave/10 p-3 text-sm">
          <summary className="cursor-pointer">
            {compiled.warnings.length} thing(s) to fix before this flow is sound
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {compiled.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="flex flex-col gap-3">
        {[
          {
            label: 'Build sheet',
            help: 'Printable checklist for building it by hand in the Studio canvas, shallowest room first. Start here.',
            file: `${graph.story.title}-build-sheet.txt`,
            body: sheet,
            type: 'text/plain',
          },
          {
            label: 'Studio flow JSON',
            help: 'Flow definition with layout coordinates from the automap. Verify your account can import a flow definition before relying on this.',
            file: `${graph.story.title}-flow.json`,
            body: studioFlowJson(graph, compiled, positions),
            type: 'application/json',
          },
          {
            label: 'Audio manifest',
            help: 'CSV of slug, status, filename and duration, for tracking VO sessions.',
            file: `${graph.story.title}-audio.csv`,
            body: audioManifestCsv(graph),
            type: 'text/csv',
          },
          {
            label: 'Printable script',
            help: 'One room per section, for VO talent.',
            file: `${graph.story.title}-script.txt`,
            body: printableScript(graph),
            type: 'text/plain',
          },
          {
            label: 'Story JSON',
            help: 'Full backup. The whole thing round-trips.',
            file: `${graph.story.title}.json`,
            body: storyJson(graph),
            type: 'application/json',
          },
        ].map((out) => (
          <div key={out.label} className="rounded border border-mortar/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm text-parchment">{out.label}</h2>
                <p className="mt-1 text-xs text-mortar">{out.help}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => void copy(out.label, out.body)}
                  className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch"
                >
                  {copied === out.label ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => download(out.file, out.body, out.type)}
                  className="rounded bg-torch px-3 py-2 text-xs text-depth"
                >
                  Download
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-mortar">Preview the build sheet</summary>
        <pre className="mt-3 max-h-[60vh] overflow-auto rounded border border-mortar/40 bg-depth p-3 text-xs">
          {sheet}
        </pre>
      </details>
    </main>
  )
}
