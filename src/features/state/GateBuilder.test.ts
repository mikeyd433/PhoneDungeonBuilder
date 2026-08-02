import { describe, expect, it } from 'vitest'
import type { GateExpression } from '@/types/domain'
import { fromFlat, toFlat } from './gateShape'

describe('gate expression <-> editor shape', () => {
  it('starts a new gate open, with no conditions', () => {
    expect(toFlat(null)).toEqual({ root: 'and', leaves: [] })
  })

  it('round-trips the example from spec §2', () => {
    const expr: GateExpression = {
      op: 'and',
      args: [
        { op: 'has', var: 'HARPOON' },
        { op: 'not', args: [{ op: 'has', var: 'WOUNDED' }] },
        { op: 'gte', var: 'ROPE_LENGTH', value: 3 },
      ],
    }
    const flat = toFlat(expr)!
    expect(flat.root).toBe('and')
    expect(flat.leaves).toHaveLength(3)
    // not(has X) normalises to lacks X — same meaning, one row in the editor.
    expect(flat.leaves[1]).toEqual({ op: 'lacks', var: 'WOUNDED' })
    expect(fromFlat(flat)).toEqual({
      op: 'and',
      args: [
        { op: 'has', var: 'HARPOON' },
        { op: 'lacks', var: 'WOUNDED' },
        { op: 'gte', var: 'ROPE_LENGTH', value: 3 },
      ],
    })
  })

  it('lifts a bare leaf into a single-condition gate', () => {
    expect(toFlat({ op: 'has', var: 'KEY' })).toEqual({
      root: 'and',
      leaves: [{ op: 'has', var: 'KEY' }],
    })
  })

  it('preserves an OR root', () => {
    const flat = toFlat({
      op: 'or',
      args: [
        { op: 'has', var: 'KEY' },
        { op: 'has', var: 'CROWBAR' },
      ],
    })!
    expect(flat.root).toBe('or')
    expect(flat.leaves).toHaveLength(2)
  })

  it('refuses to flatten a tree it cannot represent, rather than losing conditions', () => {
    // A nested or-inside-and is beyond the flat editor. Returning null lets the
    // caller show a read-only summary; silently flattening would change what
    // the gate means.
    const nested: GateExpression = {
      op: 'and',
      args: [
        { op: 'has', var: 'A' },
        { op: 'or', args: [{ op: 'has', var: 'B' }, { op: 'has', var: 'C' }] },
      ],
    }
    expect(toFlat(nested)).toBeNull()
  })

  it('normalises not(lacks X) to has X', () => {
    const flat = toFlat({
      op: 'and',
      args: [{ op: 'not', args: [{ op: 'lacks', var: 'KEY' }] }],
    })!
    expect(flat.leaves[0]).toEqual({ op: 'has', var: 'KEY' })
  })
})
