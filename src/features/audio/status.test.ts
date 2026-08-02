import { describe, expect, it } from 'vitest'
import { nextStatus } from './status'

describe('nextStatus (F3.4)', () => {
  it('advances a blank room to scripted once narration exists', () => {
    expect(nextStatus('stub', false, true)).toBe('scripted')
  })

  it('advances to recorded once audio exists', () => {
    expect(nextStatus('scripted', true, true)).toBe('recorded')
  })

  it('never silently demotes an approved take', () => {
    // Re-recording an approved room must not quietly strip the sign-off; that
    // is a decision for a person, via the checkbox.
    expect(nextStatus('approved', true, true)).toBe('approved')
    expect(nextStatus('approved', false, false)).toBe('approved')
  })

  it('falls back to stub with neither script nor audio', () => {
    expect(nextStatus('stub', false, false)).toBe('stub')
  })

  it('treats audio as outranking narration', () => {
    expect(nextStatus('stub', true, false)).toBe('recorded')
  })
})
