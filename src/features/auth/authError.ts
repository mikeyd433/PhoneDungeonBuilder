import type { AuthError } from '@supabase/supabase-js'

/** supabase-js builds its message by JSON.stringify-ing any response body that
 *  carries none of the fields it looks for. A GoTrue 500 does exactly that, so
 *  the sign-in screen showed a bare `{}` — technically the error, and no help at
 *  all. Fall back to the status code and say who can act on it. */
export function describeAuthError(error: AuthError): string {
  const raw = error.message?.trim() ?? ''
  const useless = raw === '' || raw === '{}' || raw === '[object Object]'
  if (!useless) return raw
  const status = error.status ?? 0
  if (status >= 500) {
    return `The sign-in service answered ${status} with no reason given. That's a fault on the server side, not something you typed — try again in a minute.`
  }
  if (status === 429) return 'Too many links requested. Wait a minute and try again.'
  if (status === 0) return 'Could not reach the sign-in service. Check your connection.'
  return `Sign-in failed (${status}).`
}
