import { RELEASES } from './changelog'

/**
 * Which build this is, and what changed in it.
 *
 * The version used to be four grey characters in the corner that took no
 * clicks — enough to answer "did my push land" if you already knew what the
 * commit hash meant, and nothing at all otherwise. The question underneath it
 * is really two: *which* build am I looking at, and *what is different about
 * it*. So the number is a button and this is what it opens.
 *
 * The commit and the build time stay, because they are what actually settles
 * "am I looking at the fix" — a version number moves once a day at most, and
 * the service worker can hand back a stale shell either way.
 */
export default function BuildSheet({ onClose }: { onClose: () => void }) {
  const built = new Date(__BUILT_AT__)
  const stamp = built.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-depth/85" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-carved text-base text-torch">Jackie Dungeon {__APP_VERSION__}</h3>
            <p className="mt-0.5 font-carved text-xs text-mortar">
              build {__APP_COMMIT__} · {stamp}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-sm text-mortar underline">
            Done
          </button>
        </div>

        <p className="mb-4 mt-2 text-xs text-cold">
          The commit is the part that settles whether a fix has landed — the site rebuilds on every
          push and the app can hand back a stale shell.
        </p>

        <ol className="flex flex-col gap-4">
          {RELEASES.map((release) => (
            <li key={release.version} className="border-t border-mortar/30 pt-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-carved text-sm text-torch">{release.version}</span>
                <span className="text-sm text-parchment">{release.title}</span>
                <span className="ml-auto text-xs text-mortar">{release.date}</span>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {release.changes.map((change, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-cold">
                    <span aria-hidden className="select-none text-mortar">
                      ·
                    </span>
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
