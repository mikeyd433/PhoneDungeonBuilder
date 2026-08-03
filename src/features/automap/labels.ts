import type { MapRoom } from './layout'

/** A room's name, broken to fit the box: two lines of about fourteen, then an
 *  ellipsis. A title is a phrase, and one line cut at 13 characters read as
 *  neither the name nor an abbreviation of it. */
export function nameLines(room: Pick<MapRoom, 'title' | 'slug'>): string[] {
  const text = (room.title || room.slug).trim()
  if (!text) return []
  const words = text.split(/\s+/)
  const lines: string[] = ['']
  for (const word of words) {
    const line = lines[lines.length - 1]
    if (!line) lines[lines.length - 1] = word
    else if (`${line} ${word}`.length <= 14) lines[lines.length - 1] = `${line} ${word}`
    else if (lines.length < 2) lines.push(word)
    else {
      // Out of lines: the tail becomes an ellipsis rather than silently
      // vanishing, so a trimmed name never reads as the whole name.
      lines[1] = `${lines[1].slice(0, 13)}…`
      break
    }
  }
  return lines.map((l) => (l.length > 15 ? `${l.slice(0, 14)}…` : l))
}
