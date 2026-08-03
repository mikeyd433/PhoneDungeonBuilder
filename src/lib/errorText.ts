/**
 * Whatever was thrown, as something a person can read.
 *
 * `instanceof Error ? message : String(e)` was the idiom everywhere in this app
 * and it is wrong for the one thing that actually throws here: a Supabase error
 * is a plain object carrying `message`, `details` and `hint`, not an Error — so
 * the String branch produced `[object Object]` and the banner told the author
 * nothing whatsoever. Seen for real the first time a door-visibility write
 * failed against a story the browser was not signed in to.
 */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; error?: unknown }
    // Postgres puts genuinely useful words in `details` and `hint` — "Key (id)
    // already exists" — but a network failure dumps a stack trace there, and a
    // banner full of bundle URLs is no more readable than [object Object].
    const usable = (p: unknown): p is string =>
      typeof p === 'string' &&
      p.trim().length > 0 &&
      p.length <= 200 &&
      !/\bat https?:\/\//.test(p) &&
      !/\n\s+at\s/.test(p)

    const parts = [o.message, o.details, o.hint].filter(usable)
    if (parts.length > 0) return parts.join(' — ')
    // A message too long or too stack-like to join is still the best thing
    // there is; trimmed to its first line rather than dropped.
    if (typeof o.message === 'string' && o.message.trim()) {
      return o.message.split('\n')[0].slice(0, 200)
    }
    if (typeof o.error === 'string') return o.error
    // Better a readable dump than "[object Object]": the keys at least name
    // what went wrong.
    try {
      return JSON.stringify(e)
    } catch {
      return 'Something went wrong.'
    }
  }
  return String(e)
}
