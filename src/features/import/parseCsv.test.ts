import { describe, expect, it } from 'vitest'
import { parseCsv, parseCsvTable } from './parseCsv'

describe('parseCsv', () => {
  it('parses a plain grid', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas inside quoted dialogue', () => {
    // The whole reason this parser exists.
    const csv = 'slug,dialogue\nSHARKS_1,"The hull groans, and something big circles below."'
    expect(parseCsv(csv)[1]).toEqual([
      'SHARKS_1',
      'The hull groans, and something big circles below.',
    ])
  })

  it('handles escaped double quotes', () => {
    expect(parseCsv('a\n"She said ""run"""')[1]).toEqual(['She said "run"'])
  })

  it('handles a hard line break inside a quoted cell', () => {
    const csv = 'slug,dialogue\nA,"line one\nline two"'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[1][1]).toBe('line one\nline two')
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('﻿slug,title')[0][0]).toBe('slug')
  })

  it('preserves leading whitespace inside quotes but trims bare fields', () => {
    expect(parseCsv('a,b\n  x  ,"  y  "')[1]).toEqual(['x', '  y  '])
  })

  it('keeps empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,')[1]).toEqual(['1', '', ''])
  })
})

describe('parseCsvTable', () => {
  it('keys rows by header', () => {
    const t = parseCsvTable('Node name,Dialogue\nSHARKS_1,It groans')
    expect(t.headers).toEqual(['Node name', 'Dialogue'])
    expect(t.rows[0]['Node name']).toBe('SHARKS_1')
  })

  it('disambiguates duplicate headers instead of losing a column', () => {
    const t = parseCsvTable('Item,Item\nHARPOON,LANTERN')
    expect(t.headers).toEqual(['Item', 'Item_2'])
    expect(t.rows[0]['Item_2']).toBe('LANTERN')
  })

  it('reports ragged rows rather than dropping them', () => {
    const t = parseCsvTable('a,b,c\n1,2,3\n4,5')
    expect(t.rows).toHaveLength(2)
    expect(t.raggedRows).toHaveLength(1)
    expect(t.raggedRows[0].line).toBe(3)
  })

  it('skips blank lines', () => {
    const t = parseCsvTable('a,b\n1,2\n\n3,4\n')
    expect(t.rows).toHaveLength(2)
  })
})
