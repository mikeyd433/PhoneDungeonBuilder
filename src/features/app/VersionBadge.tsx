/**
 * Which build this is, in the corner of every screen.
 *
 * The site rebuilds on every push and a service worker can hand back a stale
 * shell, so "am I looking at the fix?" is otherwise unanswerable from a phone.
 * The commit is the part that actually settles it; the version alone changes
 * too rarely to mean anything.
 *
 * Sits above everything and takes no clicks, so it can never be the reason a
 * button underneath it does nothing. The room header keeps its nav clear of it
 * on wide screens, where the two would otherwise share the corner.
 */
export default function VersionBadge() {
  const built = new Date(__BUILT_AT__)
  // Local time: the question it answers is "did my push land", and the answer
  // is easier to check against a clock in the room.
  const stamp = built.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <span
      title={`Jackie Dungeon ${__APP_VERSION__} · ${__APP_COMMIT__} · built ${stamp}`}
      aria-label={`Build ${__APP_COMMIT__}, ${stamp}`}
      className="pointer-events-none fixed right-1 top-0 z-50 select-none font-carved text-[10px] leading-4 text-mortar/50"
    >
      {__APP_VERSION__}·{__APP_COMMIT__}
    </span>
  )
}
