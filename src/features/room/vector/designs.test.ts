import { describe, expect, it } from 'vitest'
import { designFor, DEFAULT_DESIGN, ROOM_DESIGNS } from './designs'

describe('room designs', () => {
  it('offers enough places that a long story is not one room repeated', () => {
    expect(ROOM_DESIGNS.length).toBeGreaterThanOrEqual(12)
  })

  it('has unique ids', () => {
    expect(new Set(ROOM_DESIGNS.map((d) => d.id)).size).toBe(ROOM_DESIGNS.length)
  })

  /**
   * The point of adding a design is that it looks like somewhere else.
   *
   * Two designs sharing a texture, a floor and a palette are the same room with
   * two names in the picker — which is exactly what "a cave" was before the
   * dripping one, the crystal one and the crawl were told apart.
   */
  it('never draws two designs the same way', () => {
    const seen = new Map<string, string>()
    for (const d of ROOM_DESIGNS) {
      const key = [d.texture, d.floorMotif, d.wallMotif ?? 'none', d.wall.lit, d.edge.lit].join('|')
      const clash = seen.get(key)
      expect(clash, `${d.id} is indistinguishable from ${clash}`).toBeUndefined()
      seen.set(key, d.id)
    }
  })

  it('falls back to stone for an unknown or missing id', () => {
    // A design removed by a later migration must not break rooms still on it.
    expect(designFor('no-such-design').id).toBe(DEFAULT_DESIGN)
    expect(designFor(null).id).toBe(DEFAULT_DESIGN)
    expect(designFor(undefined).id).toBe(DEFAULT_DESIGN)
  })

  it('always renders darker unlit than lit', () => {
    // The rule that dark means unrecorded outranks any design's palette, so no
    // design may invert it.
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
    }
    for (const d of ROOM_DESIGNS) {
      expect(lum(d.wall.dim), `${d.id} wall`).toBeLessThan(lum(d.wall.lit))
      expect(lum(d.floor.dim), `${d.id} floor`).toBeLessThan(lum(d.floor.lit))
    }
  })

  it('describes each design in a sentence, for the picker', () => {
    for (const d of ROOM_DESIGNS) {
      expect(d.name.length, d.id).toBeGreaterThan(2)
      expect(d.blurb.length, d.id).toBeGreaterThan(20)
    }
  })
})
