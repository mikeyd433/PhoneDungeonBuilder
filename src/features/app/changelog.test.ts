import { describe, expect, it } from 'vitest'
import { CURRENT, RELEASES } from './changelog'
import pkg from '../../../package.json'

/**
 * The changelog is the only list of these facts, so the things that could
 * silently disagree with it are asserted rather than trusted.
 */
describe('the changelog', () => {
  it('leads with the version this build calls itself', () => {
    expect(CURRENT).toBe(pkg.version)
  })

  it('is newest first', () => {
    const dates = RELEASES.map((r) => r.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('gives every release a title and something an author would notice', () => {
    for (const r of RELEASES) {
      expect(r.title.trim(), r.version).not.toBe('')
      expect(r.changes.length, r.version).toBeGreaterThan(0)
      for (const c of r.changes) expect(c.trim().length, `${r.version}: "${c}"`).toBeGreaterThan(20)
    }
  })

  it('numbers each release below the one above it', () => {
    const rank = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0)
    for (let i = 1; i < RELEASES.length; i++) {
      expect(rank(RELEASES[i - 1].version), RELEASES[i].version).toBeGreaterThan(
        rank(RELEASES[i].version),
      )
    }
  })
})
