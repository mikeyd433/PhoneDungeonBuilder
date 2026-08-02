import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseCsvTable } from '@/features/import/parseCsv'
import { guessMapping, IMPORT_FIELDS, type ColumnMapping } from '@/features/import/mapping'
import { buildImportPlan, importIsWorthIt } from '@/features/import/buildImport'
import { commitImportPlan } from '@/features/import/commitImport'
import { createStory } from '@/lib/api'

/**
 * F2.11 — CSV import with a preview. §8: never write directly from a CSV without
 * a review step, so the plan is always shown and confirmed before anything is
 * created.
 */
export default function Import() {
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const table = useMemo(() => (raw ? parseCsvTable(raw) : null), [raw])
  const plan = useMemo(
    () => (table ? buildImportPlan(table.rows, mapping) : null),
    [table, mapping],
  )

  async function onFile(file: File) {
    const text = await file.text()
    const parsed = parseCsvTable(text)
    setRaw(text)
    setFileName(file.name)
    setMapping(guessMapping(parsed.headers))
    if (!title) setTitle(file.name.replace(/\.csv$/i, ''))
  }

  async function commit() {
    if (!plan || !title.trim()) return
    setBusy(true)
    setError(null)
    try {
      // No seeded entrance: the sheet's first row becomes the root.
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
      <h1 className="mb-4 text-xl text-torch">Import a sheet</h1>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        className="mb-6 block w-full text-sm"
      />

      {table && (
        <>
          <p className="mb-4 text-sm text-mortar">
            {fileName} · {table.rows.length} rows · {table.headers.length} columns
            {!importIsWorthIt(table.rows.length) && (
              <span className="ml-2 text-cold">
                (under 30 rows — retyping while you learn the app may be easier)
              </span>
            )}
          </p>

          {table.raggedRows.length > 0 && (
            <p className="mb-4 rounded border border-grave/50 bg-grave/10 p-3 text-sm">
              {table.raggedRows.length} row(s) have a different column count than the header:
              lines {table.raggedRows.map((r) => r.line).join(', ')}. They are still imported —
              check them below.
            </p>
          )}

          <section className="mb-6">
            <h2 className="mb-2 text-sm text-mortar">Map the columns</h2>
            <div className="flex flex-col gap-2">
              {IMPORT_FIELDS.map((spec) => (
                <label key={spec.field} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-36 shrink-0">
                    {spec.label}
                    {spec.required && <span className="text-grave"> *</span>}
                  </span>
                  <select
                    value={mapping[spec.field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [spec.field]: e.target.value || undefined }))
                    }
                    className={field}
                  >
                    <option value="">— not imported —</option>
                    {table.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <span className="w-full text-xs text-cold sm:w-auto">{spec.help}</span>
                </label>
              ))}
            </div>
          </section>

          {plan && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm text-mortar">What will be created</h2>
              <ul className="mb-3 flex flex-wrap gap-4 text-sm">
                <li>{plan.nodes.length} rooms</li>
                <li>{plan.choices.length} exits</li>
                <li>{plan.choices.filter((c) => !c.toSlug).length} unwritten branches</li>
                <li>{plan.stateVars.length} items</li>
                <li>{plan.effects.length} item effects</li>
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
                        <td className="opacity-70">{n.narration.slice(0, 60)}</td>
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
