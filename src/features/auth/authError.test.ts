import { describe, expect, it } from 'vitest'
import type { AuthError } from '@supabase/supabase-js'
import { describeAuthError } from './authError'

/** Build the shape supabase-js hands back; only message and status matter here. */
const err = (message: string, status?: number) =>
  ({ message, status, name: 'AuthApiError' }) as AuthError

describe('describeAuthError', () => {
  it('passes a real message straight through', () => {
    expect(describeAuthError(err('Email rate limit exceeded', 429))).toBe(
      'Email rate limit exceeded',
    )
  })

  it('replaces the bare {} a GoTrue 500 produces', () => {
    const out = describeAuthError(err('{}', 500))
    expect(out).not.toContain('{}')
    expect(out).toContain('500')
  })

  it('handles an empty message and a missing status', () => {
    expect(describeAuthError(err(''))).toMatch(/connection/i)
  })

  it('names rate limiting when that is all we know', () => {
    expect(describeAuthError(err('{}', 429))).toMatch(/wait a minute/i)
  })
})
