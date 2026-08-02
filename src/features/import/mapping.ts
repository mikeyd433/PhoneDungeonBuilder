/**
 * Runtime column mapping for the CSV importer (F2.11).
 *
 * The spec's §8 table assumes a specific sheet ("Node name", "Leads to", "Item
 * received"…). Rather than hard-code those headers, every target field is
 * declared here with a list of aliases used only to *pre-select* a mapping. The
 * user confirms or overrides every column on the preview screen, so a sheet with
 * completely different headers still imports.
 */

export type ImportField =
  | 'slug'
  | 'title'
  | 'narration'
  | 'node_type'
  | 'leads_to'
  | 'item_received'
  | 'item_lost'
  | 'recorded'
  | 'audio_file'
  | 'notes'

export interface FieldSpec {
  field: ImportField
  label: string
  help: string
  required: boolean
  /** Lowercased header fragments that suggest this field. */
  aliases: string[]
  /**
   * Whether several columns can feed this one field.
   *
   * Real trackers spread exits across numbered columns — "Leads To 1" through
   * "Leads To 5" — rather than putting a comma-separated list in one cell.
   * Mapping only one of them would silently import a single exit per room and
   * quietly drop the rest of the story's branching.
   */
  repeatable?: boolean
}

export const IMPORT_FIELDS: FieldSpec[] = [
  {
    field: 'slug',
    label: 'Node name',
    help: 'The unique id for each room, e.g. SHARKS_1. Required.',
    required: true,
    aliases: ['node name', 'node', 'slug', 'name', 'id', 'room', 'scene'],
  },
  {
    field: 'title',
    label: 'Title',
    help: 'Short human label. Falls back to the node name if unmapped.',
    required: false,
    aliases: ['title', 'label', 'heading', 'short name'],
  },
  {
    field: 'narration',
    label: 'Dialogue',
    help: 'The script the caller actually hears.',
    required: false,
    aliases: ['dialogue', 'narration', 'script', 'text', 'copy', 'body'],
  },
  {
    field: 'node_type',
    label: 'Node type',
    help: 'Room or ending. Anything reading like an ending becomes one.',
    required: false,
    aliases: ['node type', 'type', 'kind'],
  },
  {
    field: 'leads_to',
    label: 'Leads to',
    help: 'Comma-separated node names. Digits are assigned 1, 2, 3 in listed order.',
    required: false,
    aliases: ['leads to', 'goes to', 'exits', 'children', 'next', 'destinations', 'options'],
    repeatable: true,
  },
  {
    field: 'item_received',
    label: 'Item received',
    help: 'Comma-separated. Imported as node-level grants — you then walk them onto the right door.',
    required: false,
    aliases: ['item received', 'items received', 'item gained', 'grants', 'gives', 'item'],
    repeatable: true,
  },
  {
    field: 'item_lost',
    label: 'Item lost',
    help: 'Comma-separated. Imported as node-level revokes.',
    required: false,
    aliases: ['item lost', 'items lost', 'item used', 'revokes', 'takes', 'loses'],
    repeatable: true,
  },
  {
    field: 'recorded',
    label: 'Recorded',
    help: 'Anything truthy marks the node as recorded.',
    required: false,
    aliases: ['recorded', 'audio', 'vo', 'voiced', 'done', 'status'],
  },
  {
    field: 'audio_file',
    label: 'Audio file name',
    help: 'Existing recording filename. Imported as a note — the file itself still has to be uploaded.',
    required: false,
    aliases: ['audio file name', 'audio file', 'filename', 'file name', 'wav', 'audio'],
  },
  {
    field: 'notes',
    label: 'Production notes',
    help: 'Not heard by the caller.',
    required: false,
    aliases: ['notes', 'note', 'comment', 'comments', 'production notes'],
  },
]

/**
 * field -> header name(s). A field absent from the map is not imported.
 *
 * Repeatable fields may hold several headers; their values are concatenated
 * before being split, so "Leads To 1..5" behaves exactly like one comma-
 * separated cell.
 */
export type ColumnMapping = Partial<Record<ImportField, string | string[]>>

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Does `haystack` contain `needle` as a run of whole words?
 *
 * Deliberately NOT a substring test. `"Widget".includes("id")` is true, which
 * would let the `id` alias claim an unrelated column — the same class of bug the
 * spec calls out in §6.1 for inventory matching, where `ROPE` falsely matches
 * `ROPEBURN`. Word-boundary matching is the fix in both places.
 */
function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true
  }
  return false
}

/**
 * Best-effort initial mapping, refined by the user on the preview screen.
 *
 * Two passes: a whole-header exact match first, then a whole-word phrase match.
 * The exact pass has to come first or a sheet with both "Node name" and "Node
 * type" maps both to `slug`, since each contains the word "node".
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const claimed = new Set<string>()
  const headerWords = new Map(headers.map((h) => [h, words(h)]))

  for (const pass of ['exact', 'phrase'] as const) {
    for (const spec of IMPORT_FIELDS) {
      if (mapping[spec.field]) continue
      const matches = headers.filter((h) => {
        if (claimed.has(h)) return false
        const hw = headerWords.get(h)!
        return pass === 'exact'
          ? spec.aliases.includes(h.trim().toLowerCase())
          : spec.aliases.some((a) => containsPhrase(hw, words(a)))
      })
      if (matches.length === 0) continue

      // A repeatable field takes the whole numbered family ("Leads To 1..5");
      // everything else takes the first match only.
      const taken = spec.repeatable ? matches : [matches[0]]
      mapping[spec.field] = spec.repeatable && taken.length > 1 ? taken : taken[0]
      for (const h of taken) claimed.add(h)
    }
  }
  return mapping
}

/**
 * §8 warns the sheet's type vocabulary may not match ours.
 *
 * Matched on whole words, not substrings. A tracker whose types are "Win" and
 * "Lose" is the case that matters here — and a substring test would also make
 * "Lose" match any cell containing "close", which is exactly the class of bug
 * that bit the column matcher.
 */
const ENDING_WORDS = new Set([
  'ending',
  'end',
  'death',
  'died',
  'die',
  'dead',
  'finish',
  'finished',
  'terminal',
  'final',
  'win',
  'won',
  'victory',
  'lose',
  'lost',
  'defeat',
  'gameover',
])

export function normalizeNodeType(raw: string): 'room' | 'ending' {
  const v = raw.trim().toLowerCase()
  if (!v) return 'room'
  if (v.replace(/[^a-z]/g, '') === 'gameover') return 'ending'
  return v.split(/[^a-z0-9]+/).some((w) => ENDING_WORDS.has(w)) ? 'ending' : 'room'
}

const TRUTHY = ['yes', 'y', 'true', '1', 'x', 'done', 'recorded', 'complete', '✓', 'checked']

export function isTruthy(raw: string): boolean {
  return TRUTHY.includes(raw.trim().toLowerCase())
}

/** Split a multi-value cell. Accepts commas, semicolons, pipes and newlines,
 *  because hand-maintained sheets use all four. */
export function splitList(raw: string): string[] {
  return raw
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}
