import { describe, expect, it } from 'vitest'
import { parseCsvTable } from './parseCsv'
import { guessMapping } from './mapping'
import { buildImportPlan } from './buildImport'

/** Parse + auto-map + plan, the way the import screen does it. */
function plan(csv: string) {
  const table = parseCsvTable(csv)
  return buildImportPlan(table.rows, guessMapping(table.headers))
}

describe('guessMapping', () => {
  it('maps the sheet shape described in spec §8', () => {
    const m = guessMapping([
      'Node name',
      'Node type',
      'Dialogue',
      'Comes from',
      'Leads to',
      'Item received',
      'Item lost',
      'Recorded',
    ])
    expect(m.slug).toBe('Node name')
    expect(m.node_type).toBe('Node type')
    expect(m.narration).toBe('Dialogue')
    expect(m.leads_to).toBe('Leads to')
    expect(m.item_received).toBe('Item received')
    expect(m.item_lost).toBe('Item lost')
    expect(m.recorded).toBe('Recorded')
  })

  it('does not map both "Node name" and "Node type" to the same field', () => {
    // Exact-match pass has to win, or the substring "node" claims both.
    const m = guessMapping(['Node name', 'Node type'])
    expect(m.slug).toBe('Node name')
    expect(m.node_type).toBe('Node type')
  })

  it('leaves unrecognised headers unmapped for the user to assign', () => {
    const m = guessMapping(['Widget', 'Thing'])
    expect(m.slug).toBeUndefined()
  })
})

describe('buildImportPlan', () => {
  it('assigns digits 1,2,3 in listed order', () => {
    const p = plan(
      'Node name,Leads to\nENTRANCE,"Hull, Deck, Hold"\nHull,\nDeck,\nHold,',
    )
    const exits = p.choices.filter((c) => c.fromSlug === 'ENTRANCE')
    expect(exits.map((c) => c.digit)).toEqual(['1', '2', '3'])
    expect(exits.map((c) => c.toSlug)).toEqual(['HULL', 'DECK', 'HOLD'])
  })

  it('turns an unresolvable destination into an unwritten branch, not a failure', () => {
    const p = plan('Node name,Leads to\nA,"B, Nowhere"\nB,')
    const bricked = p.choices.find((c) => c.unresolvedName === 'Nowhere')
    expect(bricked?.toSlug).toBeNull()
    expect(p.issues.some((i) => i.message.includes('Nowhere'))).toBe(true)
    // The row still imported — nothing was dropped.
    expect(p.nodes.map((n) => n.slug)).toEqual(['A', 'B'])
  })

  it('resolves destinations written in prose against the slugified name', () => {
    const p = plan('Node name,Leads to\nThe Groaning Hull,\nENTRANCE,the groaning hull')
    expect(p.choices[0].toSlug).toBe('THE_GROANING_HULL')
  })

  it('renames duplicate node names instead of colliding', () => {
    const p = plan('Node name\nSHARKS\nSHARKS')
    expect(p.nodes.map((n) => n.slug)).toEqual(['SHARKS', 'SHARKS_2'])
    expect(p.issues.some((i) => i.message.includes('Duplicate'))).toBe(true)
  })

  it('remaps ending vocabulary', () => {
    const p = plan('Node name,Node type\nA,room\nB,Game Over\nC,DEATH')
    expect(p.nodes.map((n) => n.node_type)).toEqual(['room', 'ending', 'ending'])
  })

  it('imports items as node-level effects and registers the state vars', () => {
    const p = plan('Node name,Item received,Item lost\nA,"harpoon, lantern",rope')
    expect(p.stateVars.map((v) => v.slug).sort()).toEqual(['HARPOON', 'LANTERN', 'ROPE'])
    expect(p.effects).toContainEqual({ nodeSlug: 'A', varSlug: 'HARPOON', operation: 'grant' })
    expect(p.effects).toContainEqual({ nodeSlug: 'A', varSlug: 'ROPE', operation: 'revoke' })
  })

  it('flags sealed rooms', () => {
    const p = plan('Node name,Leads to\nA,B\nB,\nLOST,')
    expect(p.issues.some((i) => i.message.includes('LOST') && i.message.includes('sealed'))).toBe(
      true,
    )
  })

  it('treats the first row as the dungeon entrance', () => {
    const p = plan('Node name,Leads to\nENTRANCE,B\nB,')
    expect(p.rootSlug).toBe('ENTRANCE')
  })

  it('errors when more exits than keypad digits', () => {
    const many = Array.from({ length: 15 }, (_, i) => `T${i}`).join(', ')
    const rows = Array.from({ length: 15 }, (_, i) => `T${i},`).join('\n')
    const p = plan(`Node name,Leads to\nA,"${many}"\n${rows}`)
    expect(p.issues.some((i) => i.severity === 'error' && i.message.includes('keypad'))).toBe(true)
    expect(p.choices.filter((c) => c.fromSlug === 'A')).toHaveLength(12)
  })

  it('errors rather than guessing when no name column is mapped', () => {
    const table = parseCsvTable('Widget,Thing\n1,2')
    const p = buildImportPlan(table.rows, guessMapping(table.headers))
    expect(p.issues[0].severity).toBe('error')
    expect(p.nodes).toHaveLength(0)
  })

  it('marks recorded rows', () => {
    const p = plan('Node name,Recorded\nA,yes\nB,\nC,x')
    expect(p.nodes.map((n) => n.recorded)).toEqual([true, false, true])
  })

  it('splits multi-value cells on semicolons and newlines too', () => {
    const p = plan('Node name,Leads to\nA,"B;C"\nB,\nC,')
    expect(p.choices.filter((c) => c.fromSlug === 'A')).toHaveLength(2)
  })
})
