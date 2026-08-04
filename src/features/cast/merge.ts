import type { Character, StoryGraph } from '@/types/domain'

/**
 * Two cast entries that are one person.
 *
 * The import reads a name followed by a colon out of every room's narration,
 * so the cast is only ever as consistent as the typing was: a real story here
 * came back with **Froggem** and **Froggum**, one line each, which is one
 * character and two rows. Nothing downstream can tell — they get separate
 * colours, separate figures, separate call sheets, and an actor books two
 * sessions for one part.
 *
 * Suggested, never automatic. `Shark` and `Shark King` are two characters and
 * a machine cannot know that, so what this does is put likely pairs in front of
 * somebody who does.
 */

/** Case, spacing and punctuation are not spelling differences worth keeping. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Edit distance, counting a SWAP as one mistake.
 *
 * Optimal string alignment rather than plain Levenshtein, because the typo
 * this exists to catch is very often two adjacent letters the wrong way round —
 * `Carter` / `Cartre` — and plain Levenshtein charges that two, which puts it
 * outside the tolerance a six-letter name gets. One slip of the fingers should
 * cost one.
 *
 * Bounded: bailing out once every cell in a row is over the limit gives up
 * early on the overwhelmingly common case, two names nothing like each other.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > limit) return limit + 1

  // Three rows: OSA needs the one before last to see a transposition.
  let twoBack: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, twoBack[j - 2] + 1)
      }
      row.push(v)
      if (v < best) best = v
    }
    if (best > limit) return limit + 1
    twoBack = prev
    prev = row
  }
  return prev[b.length]
}

/**
 * How far apart two names may be and still be worth asking about.
 *
 * Scaled to the SHORTER name, which is what keeps `Shark` / `Shark King`
 * apart: five characters buys one typo, and those two are four apart. A long
 * name buys two, because `Jacked Vlassic Stork` has more places to slip.
 */
function tolerance(shortest: number): number {
  if (shortest < 4) return 0
  if (shortest < 8) return 1
  return 2
}

export interface NearDuplicate {
  /** The one with more lines — the merge defaults to keeping it. */
  keep: Character
  drop: Character
  /** Why they were put together, in the words the sheet shows. */
  why: string
  /** Nothing left to judge: they are the same name typed differently. */
  certain: boolean
}

/**
 * Cast entries that look like the same person typed twice.
 *
 * Ordered so the surest pairs are first, then by how much work a wrong merge
 * would undo — a pair where one side has a single line is the cheap one to fix
 * and the likeliest to be the accident.
 */
export function nearDuplicates(graph: StoryGraph): NearDuplicate[] {
  const cast = [...graph.characters.values()]
  const lineCount = new Map<string, number>()
  for (const c of cast) lineCount.set(c.id, 0)
  for (const line of graph.dialogue.values()) {
    if (line.character_id && lineCount.has(line.character_id)) {
      lineCount.set(line.character_id, lineCount.get(line.character_id)! + 1)
    }
  }

  const out: NearDuplicate[] = []
  for (let i = 0; i < cast.length; i++) {
    for (let j = i + 1; j < cast.length; j++) {
      const a = cast[i]
      const b = cast[j]
      const na = normalise(a.name)
      const nb = normalise(b.name)
      if (!na || !nb) continue

      const limit = tolerance(Math.min(na.length, nb.length))
      const certain = na === nb
      if (!certain) {
        if (limit === 0) continue
        if (editDistance(na, nb, limit) > limit) continue
      }

      // Whoever speaks more is the one to keep: the merge rewrites every line
      // it moves into the survivor's name, so keeping the busier side is the
      // smaller edit and the likelier spelling.
      const [keep, drop] =
        (lineCount.get(a.id) ?? 0) >= (lineCount.get(b.id) ?? 0) ? [a, b] : [b, a]
      out.push({
        keep,
        drop,
        certain,
        why: certain
          ? 'the same name, typed differently'
          : `${editDistance(na, nb, 9)} letter${editDistance(na, nb, 9) === 1 ? '' : 's'} apart`,
      })
    }
  }

  return out.sort(
    (x, y) =>
      Number(y.certain) - Number(x.certain) ||
      (lineCount.get(x.drop.id) ?? 0) - (lineCount.get(y.drop.id) ?? 0) ||
      x.keep.name.localeCompare(y.keep.name),
  )
}
