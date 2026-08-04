import { useCallback, useState } from 'react'

/**
 * A choice about the interface that outlives the tab.
 *
 * Not story data — that lives in Postgres and is shared. This is the handful of
 * things that belong to whoever is sitting here: which way a panel was left,
 * what got switched off. Two people building one story should be able to
 * disagree about them, which is exactly why they are not a column on `stories`.
 *
 * `localStorage`, guarded: a private window can throw on read and on write, and
 * a preference is never worth taking the app down for. A failed read is the
 * default, a failed write is a preference that lasts the session.
 */
const KEY = (name: string) => `delve.pref.${name}`

function read(name: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(KEY(name))
    return raw === null ? fallback : raw === 'on'
  } catch {
    return fallback
  }
}

/** A boolean preference, with `fallback` as what a new user gets. */
export function useToggle(name: string, fallback: boolean): [boolean, (next: boolean) => void] {
  // Read once, lazily: this runs before paint, so the control never renders in
  // the default state and then flips.
  const [on, setOn] = useState(() => read(name, fallback))

  const set = useCallback(
    (next: boolean) => {
      setOn(next)
      try {
        localStorage.setItem(KEY(name), next ? 'on' : 'off')
      } catch {
        // A preference that lasts the session is a fine outcome here.
      }
    },
    [name],
  )

  return [on, set]
}
