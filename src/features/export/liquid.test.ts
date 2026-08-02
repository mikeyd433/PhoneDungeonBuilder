import { describe, expect, it } from 'vitest'
import type { GateExpression } from '@/types/domain'
import {
  counterAddLiquid,
  delimited,
  gateAssignmentLiquid,
  gateConditionLiquid,
  gateVarName,
  grantLiquid,
  revokeLiquid,
} from './liquid'

/**
 * A minimal stand-in for Studio's `contains`, which matches substrings — the
 * behaviour that makes the pipe delimiters load-bearing.
 */
const studioContains = (haystack: string, needle: string) => haystack.includes(needle)

describe('the substring trap (§6.1)', () => {
  it('is real: an undelimited test matches the wrong item', () => {
    // This is the bug the spec warns surfaces three weeks into recording.
    expect(studioContains('|ROPEBURN|', 'ROPE')).toBe(true)
  })

  it('is closed by delimiting both sides', () => {
    expect(studioContains('|ROPEBURN|', delimited('ROPE'))).toBe(false)
    expect(studioContains('|ROPE|', delimited('ROPE'))).toBe(true)
  })

  it('does not confuse a prefix, a suffix, or a substring', () => {
    const inv = '|HARPOON|LANTERN|TRUSTED_CAPTAIN|'
    expect(studioContains(inv, delimited('HARP'))).toBe(false)
    expect(studioContains(inv, delimited('POON'))).toBe(false)
    expect(studioContains(inv, delimited('ANTER'))).toBe(false)
    expect(studioContains(inv, delimited('TRUSTED'))).toBe(false)
    expect(studioContains(inv, delimited('HARPOON'))).toBe(true)
    expect(studioContains(inv, delimited('TRUSTED_CAPTAIN'))).toBe(true)
  })

  it('always emits delimiters on both sides of a test', () => {
    for (const liquid of [
      grantLiquid('ROPE'),
      revokeLiquid('ROPE'),
      gateConditionLiquid({ op: 'has', var: 'ROPE' }),
      gateConditionLiquid({ op: 'lacks', var: 'ROPE' }),
    ]) {
      expect(liquid).toContain('|ROPE|')
      // The bare slug must never appear inside a quoted test value.
      expect(liquid).not.toMatch(/"[^"]*[^|]ROPE[^|][^"]*"/)
    }
  })
})

describe('inventory mutation', () => {
  it('grants idempotently', () => {
    const l = grantLiquid('HARPOON')
    expect(l).toContain('contains "|HARPOON|"')
    expect(l).toContain('{% else %}')
    // The "already held" branch re-emits the string untouched.
    expect(l).toContain('{% if cur contains "|HARPOON|" %}{{ cur }}')
  })

  it('revokes by collapsing the entry back to a single pipe', () => {
    // Replacing with "|" rather than "" keeps the neighbouring delimiters intact.
    expect(revokeLiquid('HARPOON')).toBe(
      '{{ flow.variables.inv | replace: "|HARPOON|", "|" }}',
    )
  })

  it('simulates a full grant/revoke round trip correctly', () => {
    // Walk the semantics by hand the way Studio would.
    let inv = '|'
    const grant = (s: string) => (inv.includes(`|${s}|`) ? inv : `${inv}${s}|`)
    inv = grant('HARPOON')
    inv = grant('ROPE')
    inv = grant('HARPOON') // idempotent
    expect(inv).toBe('|HARPOON|ROPE|')
    inv = inv.replace('|HARPOON|', '|')
    expect(inv).toBe('|ROPE|')
    expect(studioContains(inv, delimited('ROPE'))).toBe(true)
    expect(studioContains(inv, delimited('HARPOON'))).toBe(false)
  })

  it('uses minus for a negative counter delta', () => {
    expect(counterAddLiquid('ROPE_LENGTH', 3)).toContain('plus: 3')
    expect(counterAddLiquid('ROPE_LENGTH', -2)).toContain('minus: 2')
  })
})

describe('gate compilation (§6.3)', () => {
  it('compiles the spec §2 example into one boolean', () => {
    const expr: GateExpression = {
      op: 'and',
      args: [
        { op: 'has', var: 'HARPOON' },
        { op: 'not', args: [{ op: 'has', var: 'WOUNDED' }] },
        { op: 'gte', var: 'ROPE_LENGTH', value: 3 },
      ],
    }
    const l = gateAssignmentLiquid(expr)
    expect(l).toContain('inv contains "|HARPOON|"')
    expect(l).toContain('inv contains "|WOUNDED|" == false')
    expect(l).toContain('v_ROPE_LENGTH >= 3')
    expect(l).toContain('%}pass{% else %}fail{% endif %}')
    // Counters referenced by the expression must be bound in the preamble.
    expect(l).toContain('assign v_ROPE_LENGTH = flow.variables.c_ROPE_LENGTH | default: 0')
  })

  it('pushes negation down to the leaves, since Liquid has no not operator', () => {
    expect(gateConditionLiquid({ op: 'not', args: [{ op: 'has', var: 'X' }] })).toBe(
      'inv contains "|X|" == false',
    )
    expect(gateConditionLiquid({ op: 'not', args: [{ op: 'gte', var: 'N', value: 3 }] })).toBe(
      'v_N < 3',
    )
  })

  it('treats an empty gate as open', () => {
    expect(gateConditionLiquid({ op: 'and', args: [] })).toBe('true')
  })

  it('joins alternatives with or', () => {
    expect(
      gateConditionLiquid({
        op: 'or',
        args: [
          { op: 'has', var: 'KEY' },
          { op: 'has', var: 'CROWBAR' },
        ],
      }),
    ).toBe('inv contains "|KEY|" or inv contains "|CROWBAR|"')
  })

  it('names gate variables per §6.3, with keypad symbols made legal', () => {
    expect(gateVarName('SHARKS_1', '2')).toBe('gate_SHARKS_1_d2')
    // `*` and `#` are not valid in a Liquid identifier.
    expect(gateVarName('SHARKS_1', '*')).toBe('gate_SHARKS_1_dstar')
    expect(gateVarName('SHARKS_1', '#')).toBe('gate_SHARKS_1_dhash')
  })
})
