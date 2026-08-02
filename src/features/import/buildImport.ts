import { DIGITS, type Digit, type NodeType } from '@/types/domain'
import { slugify, uniqueSlug } from '@/lib/slug'
import {
  isTruthy,
  normalizeNodeType,
  splitList,
  type ColumnMapping,
  type ImportField,
} from './mapping'

export interface PlannedNode {
  slug: string
  title: string
  narration: string
  node_type: NodeType
  notes: string | null
  recorded: boolean
  /** 1-based row in the source file, for the preview screen. */
  sourceRow: number
}

export interface PlannedChoice {
  fromSlug: string
  digit: Digit
  label: string
  /** null = bricked archway. Either the sheet left it blank or the name did not
   *  resolve to a row. */
  toSlug: string | null
  /** Set when the sheet named a destination we could not find. */
  unresolvedName?: string
}

export interface PlannedEffect {
  nodeSlug: string
  varSlug: string
  operation: 'grant' | 'revoke'
}

export interface ImportIssue {
  severity: 'error' | 'warning'
  row: number | null
  message: string
}

export interface ImportPlan {
  nodes: PlannedNode[]
  choices: PlannedChoice[]
  stateVars: Array<{ slug: string; name: string }>
  effects: PlannedEffect[]
  rootSlug: string | null
  issues: ImportIssue[]
}

/**
 * Turn mapped CSV rows into a plan. Nothing is written here — §8 is explicit
 * that a CSV must never be written straight through without a review step, so
 * this returns a description of what *would* happen and the UI renders it.
 */
export function buildImportPlan(
  rows: Array<Record<string, string>>,
  mapping: ColumnMapping,
): ImportPlan {
  const issues: ImportIssue[] = []
  const get = (row: Record<string, string>, field: ImportField): string => {
    const header = mapping[field]
    if (!header) return ''
    return (row[header] ?? '').trim()
  }

  if (!mapping.slug) {
    return {
      nodes: [],
      choices: [],
      stateVars: [],
      effects: [],
      rootSlug: null,
      issues: [{ severity: 'error', row: null, message: 'No column is mapped to Node name.' }],
    }
  }

  // ---- pass 1: nodes, and the name -> slug index the edges resolve against.
  const nodes: PlannedNode[] = []
  const takenSlugs: string[] = []
  // Both the raw sheet name and the slugified form resolve, because "Leads to"
  // cells are written by hand and rarely match the node name exactly.
  const nameToSlug = new Map<string, string>()

  rows.forEach((row, i) => {
    const sourceRow = i + 2 // +1 for the header, +1 for 1-based
    const rawName = get(row, 'slug')
    if (!rawName) {
      issues.push({ severity: 'warning', row: sourceRow, message: 'No node name — row skipped.' })
      return
    }

    const desired = slugify(rawName)
    const slug = uniqueSlug(desired, takenSlugs)
    if (slug !== desired) {
      issues.push({
        severity: 'warning',
        row: sourceRow,
        message: `Duplicate node name "${rawName}" — imported as ${slug}.`,
      })
    }
    takenSlugs.push(slug)

    const key = rawName.trim().toLowerCase()
    if (!nameToSlug.has(key)) nameToSlug.set(key, slug)
    if (!nameToSlug.has(desired.toLowerCase())) nameToSlug.set(desired.toLowerCase(), slug)

    const title = get(row, 'title') || rawName.trim()
    nodes.push({
      slug,
      title,
      narration: get(row, 'narration'),
      node_type: normalizeNodeType(get(row, 'node_type')),
      notes: get(row, 'notes') || null,
      recorded: mapping.recorded ? isTruthy(get(row, 'recorded')) : false,
      sourceRow,
    })
  })

  // ---- pass 2: edges. Digits are assigned 1,2,3… in listed order (§8).
  const choices: PlannedChoice[] = []
  const nodeBySourceRow = new Map(nodes.map((n) => [n.sourceRow, n]))

  rows.forEach((row, i) => {
    const sourceRow = i + 2
    const node = nodeBySourceRow.get(sourceRow)
    if (!node) return

    const targets = splitList(get(row, 'leads_to'))
    if (targets.length === 0) return

    if (node.node_type === 'ending' && targets.length > 0) {
      issues.push({
        severity: 'warning',
        row: sourceRow,
        message: `${node.slug} is an ending but lists exits — the exits are kept, so convert it to a room or clear them.`,
      })
    }

    if (targets.length > DIGITS.length) {
      issues.push({
        severity: 'error',
        row: sourceRow,
        message: `${node.slug} lists ${targets.length} exits; a phone keypad has only ${DIGITS.length} digits. The extras are dropped.`,
      })
    }

    targets.slice(0, DIGITS.length).forEach((target, idx) => {
      const resolved = nameToSlug.get(target.toLowerCase()) ?? nameToSlug.get(slugify(target).toLowerCase())
      if (!resolved) {
        issues.push({
          severity: 'warning',
          row: sourceRow,
          message: `${node.slug} leads to "${target}", which is not a row in this sheet — imported as an unwritten branch.`,
        })
      }
      choices.push({
        fromSlug: node.slug,
        digit: DIGITS[idx],
        label: target,
        toSlug: resolved ?? null,
        ...(resolved ? {} : { unresolvedName: target }),
      })
    })
  })

  // ---- pass 3: items. §8 notes the sheet stores these on the node while the
  // model wants most of them on the choice; import as node-level and let the
  // author walk them onto the right door afterwards.
  const stateVarNames = new Map<string, string>()
  const effects: PlannedEffect[] = []

  const collectItems = (field: 'item_received' | 'item_lost', operation: 'grant' | 'revoke') => {
    rows.forEach((row, i) => {
      const node = nodeBySourceRow.get(i + 2)
      if (!node) return
      for (const raw of splitList(get(row, field))) {
        const varSlug = slugify(raw)
        if (!stateVarNames.has(varSlug)) stateVarNames.set(varSlug, raw.trim())
        effects.push({ nodeSlug: node.slug, varSlug, operation })
      }
    })
  }
  collectItems('item_received', 'grant')
  collectItems('item_lost', 'revoke')

  // ---- structural findings the author should see before committing.
  const inbound = new Set(choices.map((c) => c.toSlug).filter(Boolean) as string[])
  const rootSlug = nodes[0]?.slug ?? null
  for (const node of nodes) {
    if (node.slug !== rootSlug && !inbound.has(node.slug)) {
      issues.push({
        severity: 'warning',
        row: node.sourceRow,
        message: `${node.slug} has nothing leading to it — it will import as a sealed room.`,
      })
    }
  }

  if (nodes.length === 0) {
    issues.push({ severity: 'error', row: null, message: 'No importable rows found.' })
  }

  return {
    nodes,
    choices,
    stateVars: [...stateVarNames].map(([slug, name]) => ({ slug, name })),
    effects,
    rootSlug,
    issues,
  }
}

/** §8's decision rule: under ~30 filled rows, retyping while you learn the app
 *  is probably better than importing. */
export function importIsWorthIt(rowCount: number): boolean {
  return rowCount > 30
}
