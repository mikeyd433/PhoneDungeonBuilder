import { describe, expect, it } from 'vitest'
import { countWords, estimateSeconds, formatDuration, isLongNarration } from './speech'

describe('countWords', () => {
  it('is zero for blank text', () => {
    expect(countWords('   \n ')).toBe(0)
  })
  it('collapses runs of whitespace', () => {
    expect(countWords('one   two\nthree')).toBe(3)
  })
})

describe('estimateSeconds', () => {
  it('is zero for nothing', () => {
    expect(estimateSeconds('')).toBe(0)
  })

  it('reads 150 words in about a minute', () => {
    const text = Array.from({ length: 150 }, () => 'word').join(' ')
    expect(estimateSeconds(text)).toBeCloseTo(60, 0)
  })

  it('allows extra time for spoken digits', () => {
    const plain = estimateSeconds('press one to go below')
    const digits = estimateSeconds('press 1 to go below')
    expect(digits).toBeGreaterThan(plain)
  })
})

describe('isLongNarration', () => {
  it('passes a short room', () => {
    expect(isLongNarration('The hull groans. Something big is circling below.')).toBe(false)
  })

  it('warns once a room becomes a monologue', () => {
    const text = Array.from({ length: 60 }, () => 'word').join(' ')
    expect(isLongNarration(text)).toBe(true)
  })
})

describe('formatDuration', () => {
  it('shows seconds under a minute', () => {
    expect(formatDuration(4200)).toBe('4s')
  })
  it('shows m:ss over a minute', () => {
    expect(formatDuration(83_000)).toBe('1:23')
  })
})
