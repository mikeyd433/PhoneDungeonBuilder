import { useMemo, useState } from 'react'
import { HELP } from './help'

/**
 * What everything does, and where it is.
 *
 * A search box rather than a table of contents, because the question this
 * answers is almost always "where is the thing that does X" and X is a word
 * you already have. It matches the WHERE line as well as the title, so typing
 * "cast" finds everything on that page and typing "⋯" finds every job that
 * starts at a door.
 *
 * `needs` is drawn apart from `what`, in the alarm colour: most of what looks
 * broken in this app is a prerequisite nobody mentioned — a figure on a
 * character with no split lines draws nothing, a fork needs a destination
 * before it can fork — and burying those in a paragraph is how they stay
 * unmentioned.
 */
export default function HelpSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return HELP
    return HELP.map((section) => ({
      ...section,
      topics: section.topics.filter((t) =>
        `${t.title} ${t.where} ${t.what} ${t.needs ?? ''}`.toLowerCase().includes(q),
      ),
    })).filter((section) => section.topics.length > 0)
  }, [query])

  const found = sections.reduce((n, s) => n + s.topics.length, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-carved text-base text-torch">How this works</h3>
            <p className="mt-0.5 text-xs text-cold">
              Every feature, what it does, and the taps that get you there.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-mortar underline">
            Done
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — item, figure, call sheet, fork…"
          aria-label="Search the help"
          className="mb-4 w-full rounded border border-mortar/60 bg-stone px-3 py-2 text-sm outline-none focus:border-torch"
        />

        {query.trim() && (
          <p className="mb-3 text-xs text-mortar">
            {found === 1 ? '1 thing matches' : `${found} things match`} “{query.trim()}”.
          </p>
        )}

        <div className="flex flex-col gap-5">
          {sections.map((section) => (
            <section key={section.heading}>
              <h4 className="font-carved uppercase tracking-[0.12em] text-torch">
                {section.heading}
              </h4>
              {!query.trim() && <p className="mt-0.5 text-xs text-cold">{section.blurb}</p>}

              <ul className="mt-2 flex flex-col gap-3">
                {section.topics.map((topic) => (
                  <li key={topic.title} className="rounded border border-mortar/30 p-3">
                    <p className="text-sm text-parchment">{topic.title}</p>
                    {/* The path first: a description with no path is a feature
                        that still cannot be found. */}
                    <p className="mt-1 font-carved text-xs text-torch">{topic.where}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-cold">{topic.what}</p>
                    {topic.needs && (
                      <p className="mt-1.5 text-xs leading-relaxed text-grave">
                        <strong className="uppercase tracking-wider">Needs</strong> — {topic.needs}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {found === 0 && (
          <p className="text-sm text-cold">
            Nothing matches that. Try a word from the screen you are looking at — “door”, “item”,
            “record”, “export”.
          </p>
        )}
      </div>
    </div>
  )
}
