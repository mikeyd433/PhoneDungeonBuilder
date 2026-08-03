import { describe, expect, it } from 'vitest'
import { errorText } from './errorText'

/**
 * The banner has to say what went wrong.
 *
 * Every catch in this app used `e instanceof Error ? e.message : String(e)`,
 * and a Supabase error is not an Error — it is a plain object with `message`,
 * `details` and `hint`. So every failed write showed the author `[object
 * Object]`, which is indistinguishable from the app being broken.
 */
describe('what the banner shows', () => {
  it('reads a real Error', () => {
    expect(errorText(new Error('nope'))).toBe('nope')
  })

  /** The case that made this exist. */
  it('reads a Supabase error, which is not an Error', () => {
    expect(
      errorText({
        message: 'new row violates row-level security policy',
        details: null,
        hint: null,
        code: '42501',
      }),
    ).toBe('new row violates row-level security policy')
  })

  it('adds the details and hint when Postgres gives them', () => {
    expect(
      errorText({ message: 'duplicate key', details: 'Key (id) already exists', hint: 'use upsert' }),
    ).toBe('duplicate key — Key (id) already exists — use upsert')
  })

  /** A network failure dumps a stack into `details`, and a banner full of
   *  bundle URLs is no more readable than the two words this replaced. */
  it('drops a stack trace rather than pasting it into the banner', () => {
    const out = errorText({
      message: 'TypeError: Failed to fetch',
      details:
        'TypeError: Failed to fetch at http://localhost:5173/deps/supabase.js:19858:23 at http://localhost:5173/deps/supabase.js:19897:12',
      hint: null,
    })
    expect(out).toBe('TypeError: Failed to fetch')
  })

  it('passes a plain string through', () => {
    expect(errorText('offline')).toBe('offline')
  })

  /** Better a readable dump than the two words that say nothing. */
  it('never returns "[object Object]"', () => {
    expect(errorText({ status: 500 })).not.toContain('[object Object]')
    expect(errorText({ status: 500 })).toContain('500')
  })

  it('survives something that cannot be stringified', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(errorText(cyclic)).toBe('Something went wrong.')
  })
})
