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

/**
 * The real tracker (CYOA_Node_Tracker.xlsx) rather than the shape §8 assumed.
 * Two things differ and both would silently corrupt an import:
 * exits live in five numbered columns, and endings are typed "Win"/"Lose".
 */
describe('the real CYOA_Node_Tracker shape', () => {
  const HEADERS =
    'Node ID,Node Type,Dialogue,Comes From 1,Comes From 2,Leads To 1,Leads To 2,Leads To 3,' +
    'Item Received,Item Lost,Voice Actor,Audio File Name,Recorded,Notes'

  it('maps all five Leads To columns to one field, not just the first', () => {
    const m = guessMapping(HEADERS.split(','))
    expect(Array.isArray(m.leads_to)).toBe(true)
    expect(m.leads_to).toEqual(['Leads To 1', 'Leads To 2', 'Leads To 3'])
  })

  it('does not let "Comes From" columns steal the Leads To mapping', () => {
    // Comes From is derived and must stay unmapped (§8 says ignore it).
    const m = guessMapping(HEADERS.split(','))
    const claimed = Object.values(m).flat()
    expect(claimed).not.toContain('Comes From 1')
    expect(claimed).not.toContain('Comes From 2')
  })

  it('reads exits spread across numbered columns into digits 1,2,3', () => {
    const p = plan(
      `Node ID,Leads To 1,Leads To 2,Leads To 3\nBEACH_1,SHARKS_1,SHARKS_2,SHARKS_3\n` +
        'SHARKS_1,,,\nSHARKS_2,,,\nSHARKS_3,,,',
    )
    const exits = p.choices.filter((c) => c.fromSlug === 'BEACH_1')
    expect(exits.map((c) => c.digit)).toEqual(['1', '2', '3'])
    expect(exits.map((c) => c.toSlug)).toEqual(['SHARKS_1', 'SHARKS_2', 'SHARKS_3'])
  })

  it('closes gaps so a half-filled row does not skip digits', () => {
    // Leads To 1 and 3 filled, 2 blank: the caller should press 1 and 2.
    const p = plan(
      'Node ID,Leads To 1,Leads To 2,Leads To 3\nA,B,,C\nB,,,\nC,,,',
    )
    const exits = p.choices.filter((c) => c.fromSlug === 'A')
    expect(exits.map((c) => c.digit)).toEqual(['1', '2'])
    expect(exits.map((c) => c.toSlug)).toEqual(['B', 'C'])
  })

  it('treats Win and Lose as endings', () => {
    const p = plan(
      'Node ID,Node Type\nA,Dialogue\nB,Choice\nC,Win\nD,Lose\nE,Branch\nF,Item Received',
    )
    expect(p.nodes.map((n) => n.node_type)).toEqual([
      'room',
      'room',
      'ending',
      'ending',
      'room',
      'room',
    ])
  })

  it('keeps the sheet audio filename as a note without faking a recording', () => {
    // Pointing audio_path at a file that isn't in Storage would light the torch
    // for a room with nothing to play.
    const p = plan('Node ID,Audio File Name,Notes\nA,INTRO_1_v1.wav,retake wanted')
    expect(p.nodes[0].notes).toContain('INTRO_1_v1.wav')
    expect(p.nodes[0].notes).toContain('retake wanted')
    expect(p.nodes[0].recorded).toBe(false)
  })

  it('imports the tracker example row end to end', () => {
    const p = plan(
      `${HEADERS}\n` +
        'INTRO_1,Dialogue,"You wake up on a beach. The sun is blinding.",START_1,,BEACH_1,BEACH_2,,' +
        ',,VO_Actor_Name,INTRO_1_v1.wav,No,Example row\n' +
        'BEACH_1,Dialogue,,,,,,,,,,,,\n' +
        'BEACH_2,Dialogue,,,,,,,,,,,,',
    )
    expect(p.nodes.map((n) => n.slug)).toEqual(['INTRO_1', 'BEACH_1', 'BEACH_2'])
    expect(p.nodes[0].narration).toBe('You wake up on a beach. The sun is blinding.')
    const exits = p.choices.filter((c) => c.fromSlug === 'INTRO_1')
    expect(exits.map((c) => c.toSlug)).toEqual(['BEACH_1', 'BEACH_2'])
    expect(p.nodes[0].recorded).toBe(false)
  })
})
