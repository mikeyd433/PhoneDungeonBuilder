import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseCsvTable, type CsvTable } from '@/features/import/parseCsv'
import { guessMapping, IMPORT_FIELDS, type ColumnMapping } from '@/features/import/mapping'
import { buildImportPlan, importIsWorthIt } from '@/features/import/buildImport'
import {
  buildBrainstormPlan,
  colorsUsed,
  DEFAULT_ENDING_COLORS,
  isBrainstormExport,
  type BrainstormExport,
} from '@/features/import/brainstorm'
import { commitImportPlan } from '@/features/import/commitImport'
import { createStory } from '@/lib/api'

/**
 * F2.11 — import with a preview. §8: never write directly from a file without a
 * review step, so the plan is always shown and confirmed before anything is
 * created.
 *
 * Two sources, because the story can live in either:
 *  - a spreadsheet exported as CSV, with a column-mapping step
 *  - a Brainstorm (React Flow) JSON export, which needs no mapping since its
 *    edges already carry structure
 */
type Source =
  | { kind: 'csv'; table: CsvTable }
  | { kind: 'brainstorm'; data: BrainstormExport }

export default function Import() {
  const [source, setSource] = useState<Source | null>(null)
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [endingColors, setEndingColors] = useState<string[]>(DEFAULT_ENDING_COLORS)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const plan = useMemo(() => {
    if (!source) return null
    return source.kind === 'csv'
      ? buildImportPlan(source.table.rows, mapping)
      : buildBrainstormPlan(source.data, endingColors)
  }, [source, mapping, endingColors])

  async function onFile(file: File) {
    setError(null)
    const text = await file.text()
    setFileName(file.name)
    if (!title) setTitle(file.name.replace(/\.(csv|json)$/i, ''))

    const looksJson = /\.json$/i.test(file.name) || text.trimStart().startsWith('{')
    if (looksJson) {
      try {
        const parsed = JSON.parse(text)
        if (!isBrainstormExport(parsed)) {
          setError(
            "That JSON isn't a Brainstorm export — it needs a `nodes` and an `edges` array. Use More → Export JSON in Brainstorm.",
          )
          setSource(null)
          return
        }
        setSource({ kind: 'brainstorm', data: parsed })
        setEndingColors(DEFAULT_ENDING_COLORS)
      } catch {
        setError("That file isn't valid JSON.")
        setSource(null)
      }
      return
    }

    const table = parseCsvTable(text)
    setSource({ kind: 'csv', table })
    setMapping(guessMapping(table.headers))
  }

  async function commit() {
    if (!plan || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      // No seeded entrance: the file's own root becomes it.
      const story = await createStory(title.trim(), false)
      await commitImportPlan(story.id, plan)
      navigate(`/story/${story.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const errors = plan?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = plan?.issues.filter((i) => i.severity === 'warning') ?? []
  const field = 'rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch'

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-xl text-torch">Import a story</h1>
      <p className="mb-6 text-sm text-mortar">
        A spreadsheet exported as CSV, or a Brainstorm graph exported with More → Export JSON.
      </p>

      <input
        type="file"
        accept=".csv,text/csv,.json,application/json"
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        className="mb-6 block w-full text-sm"
      />

      {error && !source && <p className="mb-4 text-sm text-grave">{error}</p>}

      {source && (
        <>
          <p className="mb-4 text-sm text-mortar">
            {fileName} ·{' '}
            {source.kind === 'csv'
              ? `${source.table.rows.length} rows · ${source.table.headers.length} columns`
              : `${source.data.nodes.length} nodes · ${source.data.edges.length} edges`}
            {source.kind === 'csv' && !importIsWorthIt(source.table.rows.length) && (
              <span className="ml-2 text-cold">
                (under 30 rows — retyping while you learn the app may be easier)
              </span>
            )}
          </p>

          {source.kind === 'csv' && source.table.raggedRows.length > 0 && (
            <p className="mb-4 rounded border border-grave/50 bg-grave/10 p-3 text-sm">
              {source.table.raggedRows.length} row(s) have a different column count than the header:
              lines {source.table.raggedRows.map((r) => r.line).join(', ')}. They are still
              imported — check them below.
            </p>
          )}

          {source.kind === 'csv' && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm text-mortar">Map the columns</h2>
              <div className="flex flex-col gap-2">
                {IMPORT_FIELDS.map((spec) => {
                  const current = mapping[spec.field]
                  const selected = current === undefined ? [] : ([] as string[]).concat(current)

                  // A repeatable field can be fed by several columns at once —
                  // trackers spread exits across "Leads To 1..5" rather than
                  // putting a comma-separated list in one cell, so this has to
                  // be a multi-select or four fifths of the branching is lost.
                  return (
                    <div key={spec.field} className="flex flex-wrap items-start gap-2 text-sm">
                      <span className="w-36 shrink-0 pt-2">
                        {spec.label}
                        {spec.required && <span className="text-grave"> *</span>}
                      </span>

                      {spec.repeatable ? (
                        <div className="flex flex-wrap gap-1">
                          {source.table.headers.map((h) => {
                            const on = selected.includes(h)
                            return (
                              <button
                                key={h}
                                onClick={() =>
                                  setMapping((m) => {
                                    const next = on
                                      ? selected.filter((x) => x !== h)
                                      : [...selected, h]
                                    return {
                                      ...m,
                                      [spec.field]:
                                        next.length === 0
                                          ? undefined
                                          : next.length === 1
                                            ? next[0]
                                            : next,
                                    }
                                  })
                                }
                                className={[
                                  'rounded border px-2 py-1 text-xs',
                                  on ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
                                ].join(' ')}
                              >
                                {h}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <select
                          value={typeof current === 'string' ? current : ''}
                          onChange={(e) =>
                            setMapping((m) => ({ ...m, [spec.field]: e.target.value || undefined }))
                          }
                          className={field}
                        >
                          <option value="">— not imported —</option>
                          {source.table.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      )}

                      <span className="w-full text-xs text-cold sm:w-auto sm:max-w-xs">
                        {spec.help}
                        {spec.repeatable && ' Pick every column that feeds this.'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {source.kind === 'brainstorm' && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm text-mortar">Which colours mean “ending”?</h2>
              <p className="mb-2 text-xs text-cold">
                A flowchart has no node type, so colour is the only signal for which rooms end the
                call. Everything else imports as a room.
              </p>
              <div className="flex flex-wrap gap-1">
                {colorsUsed(source.data).map((c) => {
                  const on = endingColors.includes(c)
                  return (
                    <button
                      key={c}
                      onClick={() =>
                        setEndingColors((prev) =>
                          on ? prev.filter((x) => x !== c) : [...prev, c],
                        )
                      }
                      className={[
                        'rounded border px-2 py-1 text-xs',
                        on ? 'border-grave text-grave' : 'border-mortar/60 text-mortar',
                      ].join(' ')}
                    >
                      {c}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-cold">
                Brainstorm keeps dialogue in a node&apos;s <strong>details</strong>, and carries no
                items or recorded status — those still have to be filled in here afterwards.
              </p>
            </section>
          )}

          {plan && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm text-mortar">What will be created</h2>
              <ul className="mb-3 flex flex-wrap gap-4 text-sm">
                <li>{plan.nodes.length} rooms</li>
                <li>{plan.nodes.filter((n) => n.node_type === 'ending').length} endings</li>
                <li>{plan.choices.length} exits</li>
                <li>{plan.choices.filter((c) => !c.toSlug).length} unwritten branches</li>
                <li>{plan.stateVars.length} items</li>
                <li>entrance: {plan.rootSlug ?? '—'}</li>
              </ul>

              {errors.length > 0 && (
                <div className="mb-3 rounded border border-grave bg-grave/10 p-3 text-sm">
                  <strong>{errors.length} problem(s):</strong>
                  <ul className="mt-1 list-disc pl-5">
                    {errors.map((i, n) => (
                      <li key={n}>
                        {i.row ? `Row ${i.row}: ` : ''}
                        {i.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <details className="mb-3 rounded border border-mortar/50 p-3 text-sm">
                  <summary className="cursor-pointer">{warnings.length} thing(s) to check</summary>
                  <ul className="mt-2 list-disc pl-5">
                    {warnings.map((i, n) => (
                      <li key={n}>
                        {i.row ? `Row ${i.row}: ` : ''}
                        {i.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <details className="rounded border border-mortar/50 p-3 text-sm">
                <summary className="cursor-pointer">Preview the rooms</summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-mortar">
                    <tr>
                      <th className="py-1">Slug</th>
                      <th>Type</th>
                      <th>Exits</th>
                      <th>Narration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.nodes.slice(0, 100).map((n) => (
                      <tr key={n.slug} className="border-t border-mortar/20">
                        <td className="py-1 font-paper">{n.slug}</td>
                        <td>{n.node_type}</td>
                        <td>{plan.choices.filter((c) => c.fromSlug === n.slug).length}</td>
                        <td className="opacity-70">
                          {n.narration.slice(0, 60) || <span className="text-cold">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.nodes.length > 100 && (
                  <p className="mt-2 text-cold">…and {plan.nodes.length - 100} more.</p>
                )}
              </details>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-mortar">Story title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            </label>
            <button
              onClick={commit}
              disabled={busy || !plan || plan.nodes.length === 0 || !title.trim()}
              className="rounded bg-torch px-4 py-3 font-carved uppercase tracking-[0.12em] text-depth disabled:opacity-50"
            >
              {busy ? 'Digging…' : `Create ${plan?.nodes.length ?? 0} rooms`}
            </button>
            {error && <p className="text-sm text-grave">{error}</p>}
          </section>
        </>
      )}
    </main>
  )
}
