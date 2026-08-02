/**
 * Slug generation (F2.3). Matches the existing convention in the story:
 * SHOUTY_SNAKE_CASE, e.g. SHARKS_1.
 */

const MAX_SLUG_LENGTH = 48

/** Turn a human title into a candidate slug. "Circling in the dark" -> CIRCLING_IN_THE_DARK */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_+$/g, '')

  // The DB requires slugs to start with a letter for state vars, and a leading
  // digit reads badly everywhere else, so prefix rather than reject.
  if (!base) return 'ROOM'
  return /^[0-9]/.test(base) ? `N_${base}` : base
}

/**
 * Make a slug unique within a story by appending _2, _3, … The existing
 * convention already uses trailing numbers (SHARKS_1), so this extends the
 * pattern rather than fighting it.
 */
export function uniqueSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const s of taken) used.add(s.toUpperCase())

  const base = slugify(desired)
  if (!used.has(base)) return base

  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}_${n}`
    if (!used.has(candidate)) return candidate
  }
  // Practically unreachable; better than looping forever.
  return `${base}_${Date.now()}`
}

/** State var slugs are checked by the DB against ^[A-Z][A-Z0-9_]*$ — mirror that
 *  here so the UI can reject before a round trip. */
export function isValidStateVarSlug(slug: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(slug)
}
