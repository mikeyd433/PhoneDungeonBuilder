/**
 * A small RFC 4180 CSV parser.
 *
 * Written by hand rather than pulled from a dependency because the input is a
 * spreadsheet export whose main column is *dialogue* — so quoted fields
 * containing commas, escaped double quotes, and hard line breaks inside a cell
 * are the normal case, not the edge case. A `split(',')` importer would shred
 * the narration column on the first row containing a comma.
 *
 * Handles: quoted fields, "" escapes, CRLF/LF/CR line endings, a UTF-8 BOM,
 * and a trailing newline.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false

  // Strip a UTF-8 BOM — Excel adds one and it would otherwise become part of
  // the first header name, silently breaking auto-detection.
  let text = input
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const pushField = () => {
    row.push(fieldWasQuoted ? field : field.trim())
    field = ''
    fieldWasQuoted = false
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"' // escaped quote
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      fieldWasQuoted = true
      continue
    }
    if (ch === ',') {
      pushField()
      continue
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      pushRow()
      continue
    }
    if (ch === '\n') {
      pushRow()
      continue
    }
    field += ch
  }

  // Flush the final field/row unless the file ended on a clean newline.
  if (field !== '' || fieldWasQuoted || row.length > 0) pushRow()

  // Drop entirely blank trailing rows (a trailing newline yields one).
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()

  return rows
}

export interface CsvTable {
  headers: string[]
  rows: Array<Record<string, string>>
  /** Rows whose column count did not match the header row. Kept, not dropped —
   *  §8 insists on a review step, and silently discarding rows is the opposite. */
  raggedRows: Array<{ line: number; cells: string[] }>
}

/** Parse into header-keyed records. Duplicate headers get _2, _3 suffixes so no
 *  column is silently lost. */
export function parseCsvTable(input: string): CsvTable {
  const grid = parseCsv(input)
  if (grid.length === 0) return { headers: [], rows: [], raggedRows: [] }

  const seen = new Map<string, number>()
  const headers = grid[0].map((h, i) => {
    const name = h.trim() || `Column ${i + 1}`
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return n === 1 ? name : `${name}_${n}`
  })

  const rows: Array<Record<string, string>> = []
  const raggedRows: Array<{ line: number; cells: string[] }> = []

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]
    if (cells.every((c) => c === '')) continue // blank line
    if (cells.length !== headers.length) {
      raggedRows.push({ line: r + 1, cells })
    }
    const record: Record<string, string> = {}
    headers.forEach((h, i) => {
      record[h] = cells[i] ?? ''
    })
    rows.push(record)
  }

  return { headers, rows, raggedRows }
}
