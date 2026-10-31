import { graphFromRows, type StoryRows } from '@/features/pack/fromRows'
import { compileStory } from './compile'
import { audioManifestCsv, buildSheet, printableScript, studioFlowJson } from './outputs'

/**
 * The Twilio export, as the phone runs it.
 *
 * The phone app does not have a second exporter: it bundles THIS one
 * (`pnpm build:phone-export` → android/app/src/main/assets/js/exporter.js)
 * and runs it in QuickJS. Everything that keeps a flow importable — the
 * schema rules `schema.test.ts` pins, error 81022's three causes, the
 * pipe-delimited inventory — is therefore the same code on both.
 *
 * In: the story's rows as JSON (the Supabase table shapes, which is what the
 * phone stores), with every audio path ALREADY a full URL — the phone knows
 * where the takes will be uploaded, this does not. Positions are flowchart
 * x/y per node id, so the imported flow lands laid out like the phone's chart.
 */
export function exportForTwilio(rowsJson: string, positionsJson = '{}'): string {
  const graph = graphFromRows(JSON.parse(rowsJson) as StoryRows)
  const compiled = compileStory(graph, '')
  const positions = new Map(Object.entries(JSON.parse(positionsJson) as Record<string, { x: number; y: number }>))
  return JSON.stringify({
    flow: studioFlowJson(graph, compiled, positions),
    sheet: buildSheet(graph, compiled),
    manifest: audioManifestCsv(graph),
    script: printableScript(graph),
    warnings: compiled.warnings,
    widgets: compiled.budget.total,
    limit: compiled.budget.limit,
    entry: compiled.entryWidget,
  })
}
