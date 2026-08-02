/**
 * The colours a character can be given.
 *
 * Straight from §3's palette — a cast entry picks a token, never an arbitrary
 * hex, so a speaker can never introduce a colour the dungeon doesn't already
 * use. Only the tokens that stay legible as text on `depth` are offered; the
 * darker wall colours are in the palette to be walls.
 *
 * Applied with an inline `style`, not a class. Tailwind compiles the classes it
 * can see in the source, so `text-${character.color}` would purge to nothing
 * and every speaker would render the same colour — the sort of bug that looks
 * like the data is wrong.
 */
export interface SpeakerColor {
  id: string
  name: string
  hex: string
}

export const SPEAKER_COLORS: SpeakerColor[] = [
  { id: 'parchment', name: 'Parchment', hex: '#E4D9BE' },
  { id: 'torch', name: 'Torch', hex: '#E8A33D' },
  { id: 'ember', name: 'Ember', hex: '#B85C1E' },
  { id: 'grid', name: 'Cold blue', hex: '#8FB0C2' },
  { id: 'paper', name: 'Paper', hex: '#D6E4EC' },
  { id: 'grave', name: 'Grave', hex: '#8C2F22' },
]

const BY_ID = new Map(SPEAKER_COLORS.map((c) => [c.id, c]))

/** Unknown ids fall back to parchment rather than rendering nothing. */
export function speakerHex(id: string | null | undefined): string {
  return BY_ID.get(id ?? '')?.hex ?? SPEAKER_COLORS[0].hex
}
