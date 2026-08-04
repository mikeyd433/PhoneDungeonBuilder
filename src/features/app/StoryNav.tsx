import { Link } from 'react-router-dom'

/**
 * The room's top menu.
 *
 * Was nine underlined words in a row. Underlined text is the weakest tap
 * target there is — at 430px the row scrolls, so half of it is off-screen, and
 * nothing about a five-letter word says which of the ones you can see is worth
 * pressing. As buttons they have edges, a hit area that matches the edges, and
 * room for the one mark each of them needs.
 *
 * Still one horizontally scrolling row rather than a wrapped grid: the header
 * competes with the room for height, and the room is what the app is for.
 *
 * The destinations wear no icons. A row of seven full-colour emoji is exactly
 * the atmosphere-for-its-own-sake §0 rules out — they encode nothing the word
 * beside them does not, they fight the flat vector everything else is drawn
 * in, and they cost the width that decides how much of the row you can see.
 * The two ACTIONS keep a glyph, because that is what tells them apart from the
 * seven places at a glance. `Record` wears the torch: it is the long job and
 * the one you come back to.
 */
export default function StoryNav({
  storyId,
  onUndo,
  undoLabel,
  canUndo,
  onSatchel,
}: {
  storyId: string
  onUndo: () => void
  /** What the next undo would take back, for the title. */
  undoLabel?: string
  canUndo: boolean
  onSatchel: () => void
}) {
  // `min-h-[44px]` explicitly: index.css already floors every BUTTON at the
  // 44px tap target, and these sit beside links, which it does not — so
  // without it the row was 44px buttons next to 26px links.
  const pill =
    'flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs leading-none transition-colors'
  const quiet = `${pill} border-mortar/45 text-mortar hover:border-torch/70 hover:text-torch`

  const places: Array<{ to: string; label: string; hint: string; accent?: boolean }> = [
    { to: 'map', label: 'Map', hint: 'The whole story, laid out and surveyed' },
    { to: 'cast', label: 'Cast', hint: 'Characters, voice actors and their call sheets' },
    { to: 'record', label: 'Record', hint: 'Every take in the story, in story order', accent: true },
    { to: 'playtest', label: 'Dial in', hint: 'Walk it the way a caller would' },
    { to: 'tidy', label: 'Tidy', hint: 'Clean up what the import left behind' },
    { to: 'ledger', label: 'Ledger', hint: 'Everything unfinished, in one list' },
    { to: 'export', label: 'Export', hint: 'The Twilio flow, and what is wrong with it' },
  ]

  return (
    <>
      <nav
        aria-label="This story"
        className="-mx-1 flex w-full shrink-0 items-center gap-1.5 overflow-x-auto px-1 pb-0.5 sm:ml-auto sm:w-auto"
      >
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title={canUndo ? undoLabel : 'Nothing to undo yet'}
          className={`${quiet} disabled:opacity-35 disabled:hover:border-mortar/45 disabled:hover:text-mortar`}
        >
          <span aria-hidden>↶</span>
          Undo
        </button>

        <button
          onClick={onSatchel}
          title="What the caller could be carrying here"
          className={quiet}
        >
          <span aria-hidden>🎒</span>
          Satchel
        </button>

        {places.map((place) => (
          <Link
            key={place.to}
            to={`/story/${storyId}/${place.to}`}
            title={place.hint}
            className={
              place.accent ? `${pill} border-torch/55 text-torch hover:border-torch` : quiet
            }
          >
            {place.label}
          </Link>
        ))}

      </nav>
    </>
  )
}