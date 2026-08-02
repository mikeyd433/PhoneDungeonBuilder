import { describe, expect, it } from 'vitest'
import {
  buildBrainstormPlan,
  colorsUsed,
  isBrainstormExport,
  type BrainstormExport,
} from './brainstorm'

const node = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'editableNode',
  position: { x: 0, y: 0 },
  data: { label, color: 'default', ...extra },
})

const stub = (id: string) => ({ id, type: 'stub', position: { x: 0, y: 0 }, data: {} })

const edge = (source: string, target: string, label?: string) => ({
  id: `e-${source}-${target}`,
  source,
  target,
  ...(label ? { data: { label } } : {}),
})

describe('isBrainstormExport', () => {
  it('recognises a Brainstorm export', () => {
    expect(isBrainstormExport({ nodes: [node('a', 'A')], edges: [] })).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isBrainstormExport(null)).toBe(false)
    expect(isBrainstormExport({ nodes: 'no' })).toBe(false)
    expect(isBrainstormExport({ story: {}, nodes: [] })).toBe(false)
  })
})

describe('buildBrainstormPlan', () => {
  it('maps label to title and details to narration', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'The Groaning Hull', { details: 'The hull groans.' })],
      edges: [],
    }
    const p = buildBrainstormPlan(data)
    expect(p.nodes[0].slug).toBe('THE_GROANING_HULL')
    expect(p.nodes[0].title).toBe('The Groaning Hull')
    expect(p.nodes[0].narration).toBe('The hull groans.')
  })

  it('turns edges into exits with their labels, in order', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C')],
      edges: [edge('a', 'b', 'Grab the harpoon'), edge('a', 'c', 'Back away')],
    }
    const p = buildBrainstormPlan(data)
    const exits = p.choices.filter((c) => c.fromSlug === 'A')
    expect(exits.map((c) => c.digit)).toEqual(['1', '2'])
    expect(exits.map((c) => c.label)).toEqual(['Grab the harpoon', 'Back away'])
    expect(exits.map((c) => c.toSlug)).toEqual(['B', 'C'])
  })

  it('names an unlabelled exit after its destination rather than leaving it blank', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), node('b', 'Shark Pit')],
      edges: [edge('a', 'b')],
    }
    expect(buildBrainstormPlan(data).choices[0].label).toBe('Go to SHARK_PIT')
  })

  it('bridges waypoint stubs instead of importing them as rooms', () => {
    // A → • → • → B is one exit from A to B, not three rooms.
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), stub('s1'), stub('s2'), node('b', 'B')],
      edges: [edge('a', 's1', 'onward'), edge('s1', 's2'), edge('s2', 'b')],
    }
    const p = buildBrainstormPlan(data)
    expect(p.nodes.map((n) => n.slug)).toEqual(['A', 'B'])
    expect(p.choices).toHaveLength(1)
    expect(p.choices[0]).toMatchObject({ fromSlug: 'A', toSlug: 'B', label: 'onward' })
  })

  it('fans out a stub that splits to several destinations', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), stub('s'), node('b', 'B'), node('c', 'C')],
      edges: [edge('a', 's'), edge('s', 'b'), edge('s', 'c')],
    }
    const p = buildBrainstormPlan(data)
    expect(p.choices.map((c) => c.toSlug)).toEqual(['B', 'C'])
  })

  it('does not hang on a loop of waypoints', () => {
    // A waypoint chain that circles back would recurse forever without a guard.
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), stub('s1'), stub('s2')],
      edges: [edge('a', 's1'), edge('s1', 's2'), edge('s2', 's1')],
    }
    const p = buildBrainstormPlan(data)
    expect(p.choices[0].toSlug).toBeNull()
    expect(p.issues.some((i) => i.message.includes('waypoint'))).toBe(true)
  })

  it('treats an edge into a dead-end waypoint as an unwritten branch', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), stub('s')],
      edges: [edge('a', 's', 'someday')],
    }
    const p = buildBrainstormPlan(data)
    expect(p.choices[0].toSlug).toBeNull()
    expect(p.choices[0].unresolvedName).toBe('someday')
  })

  it('uses colour to mark endings, and lets the caller choose which colour', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), node('b', 'Dead', { color: 'red' })],
      edges: [edge('a', 'b')],
    }
    expect(buildBrainstormPlan(data).nodes[1].node_type).toBe('ending')
    // Not everyone uses red for death.
    expect(buildBrainstormPlan(data, ['purple']).nodes[1].node_type).toBe('room')
  })

  it('picks the node nothing leads into as the entrance', () => {
    const data: BrainstormExport = {
      nodes: [node('mid', 'MID'), node('start', 'START'), node('end', 'END')],
      edges: [edge('start', 'mid'), edge('mid', 'end')],
    }
    expect(buildBrainstormPlan(data).rootSlug).toBe('START')
  })

  it('warns rather than guessing silently when several nodes could be the entrance', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C')],
      edges: [edge('a', 'c')],
    }
    const p = buildBrainstormPlan(data)
    expect(p.issues.some((i) => i.message.includes('nothing leading into them'))).toBe(true)
  })

  it('warns when a flowchart carries no dialogue', () => {
    // Brainstorm keeps dialogue in a node's details; a graph of bare labels
    // imports as a walkable but silent dungeon.
    const data: BrainstormExport = { nodes: [node('a', 'A'), node('b', 'B')], edges: [edge('a', 'b')] }
    const p = buildBrainstormPlan(data)
    expect(p.issues.some((i) => i.message.includes('no details text'))).toBe(true)
  })

  it('brings no items, because a flowchart has none', () => {
    const data: BrainstormExport = { nodes: [node('a', 'A')], edges: [] }
    const p = buildBrainstormPlan(data)
    expect(p.stateVars).toHaveLength(0)
    expect(p.effects).toHaveLength(0)
  })

  it('discards canvas positions', () => {
    const data: BrainstormExport = { nodes: [node('a', 'A')], edges: [] }
    expect(JSON.stringify(buildBrainstormPlan(data))).not.toContain('position')
  })

  it('lists the colours actually in use, ignoring waypoints', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A', { color: 'red' }), node('b', 'B'), stub('s')],
      edges: [],
    }
    expect(colorsUsed(data)).toEqual(['default', 'red'])
  })
})
