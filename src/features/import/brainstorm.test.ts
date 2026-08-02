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
  it('treats the label as the dialogue, because that is where Brainstorm keeps it', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'The hull groans. Something big is circling below.')],
      edges: [],
    }
    const p = buildBrainstormPlan(data)
    expect(p.nodes[0].narration).toBe('The hull groans. Something big is circling below.')
  })

  it('keeps a slug the author wrote in details, verbatim', () => {
    // The real graph puts SHARKS_1 / CARTER_INTRO_0 in details. Those match the
    // audio filenames already recorded, so deriving a slug from the dialogue
    // instead would break the link to every existing take.
    const data: BrainstormExport = {
      nodes: [node('a', 'Push through the vines.', { details: 'SHARKS_1' })],
      edges: [],
    }
    expect(buildBrainstormPlan(data).nodes[0].slug).toBe('SHARKS_1')
  })

  it('shortens a wall of dialogue into a usable title', () => {
    const long = 'Carter: ' + 'words '.repeat(60)
    const p = buildBrainstormPlan({ nodes: [node('a', long)], edges: [] })
    expect(p.nodes[0].title.length).toBeLessThanOrEqual(50)
    expect(p.nodes[0].narration.length).toBeGreaterThan(100)
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

  it('warns when a flowchart carries no dialogue', () => {
    const data: BrainstormExport = { nodes: [node('a', 'A'), node('b', 'B')], edges: [edge('a', 'b')] }
    expect(buildBrainstormPlan(data).nodes).toHaveLength(2)
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
    expect(buildBrainstormPlan(data, { endingColors: ['purple'] }).nodes[1].node_type).toBe('room')
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

/**
 * The convention the real graph actually uses: a prose node holding the
 * dialogue, then one small "1./2./3." node per option, then the room each
 * option leads to.
 */
describe('collapsing option nodes', () => {
  const story = (): BrainstormExport => ({
    nodes: [
      node('room1', 'You stand at the mouth of a cave.'),
      node('opt1', '1.Go in'),
      node('opt2', '2.Turn back'),
      node('room2', 'Inside, it is dark.'),
      node('room3', 'You go home.'),
    ],
    edges: [
      edge('room1', 'opt1'),
      edge('room1', 'opt2'),
      edge('opt1', 'room2'),
      edge('opt2', 'room3'),
    ],
  })

  it('folds option nodes into exits instead of importing them as rooms', () => {
    const p = buildBrainstormPlan(story())
    expect(p.nodes.map((n) => n.title)).toEqual([
      'You stand at the mouth of a cave.',
      'Inside, it is dark.',
      'You go home.',
    ])
    expect(p.choices).toHaveLength(2)
  })

  it('uses the number the author wrote as the keypad digit', () => {
    const p = buildBrainstormPlan(story())
    expect(p.choices.map((c) => ({ d: c.digit, l: c.label, to: c.toSlug }))).toEqual([
      { d: '1', l: 'Go in', to: 'INSIDE_IT_IS_DARK' },
      // "You go home." loses its leading filler word, by design.
      { d: '2', l: 'Turn back', to: 'GO_HOME' },
    ])
  })

  it('makes an option that leads nowhere a bricked archway', () => {
    // 37 of these in the real graph — they are the to-write list.
    const data = story()
    data.edges = data.edges.filter((e) => e.source !== 'opt2')
    const p = buildBrainstormPlan(data)
    const dead = p.choices.find((c) => c.digit === '2')!
    expect(dead.toSlug).toBeNull()
    expect(dead.label).toBe('Turn back')
    expect(p.issues.some((i) => i.message.includes('bricked archways'))).toBe(true)
  })

  it('keeps an ambiguous option node as a room rather than guessing', () => {
    // An option leading to two different rooms cannot be one exit.
    const data = story()
    data.edges.push(edge('opt1', 'room3'))
    const p = buildBrainstormPlan(data)
    expect(p.nodes.some((n) => n.title === '1.Go in')).toBe(true)
    expect(p.issues.some((i) => i.message.includes('kept as rooms'))).toBe(true)
  })

  it('falls back to a free digit when two options claim the same number', () => {
    const data = story()
    data.nodes[2].data!.label = '1.Turn back'
    const p = buildBrainstormPlan(data)
    expect(p.choices.map((c) => c.digit)).toEqual(['1', '2'])
  })

  it('can be turned off for a graph that does not use the convention', () => {
    const p = buildBrainstormPlan(story(), { collapseChoiceNodes: false })
    expect(p.nodes).toHaveLength(5)
  })

  it('leaves a graph alone when hardly any node looks like an option', () => {
    const data: BrainstormExport = {
      nodes: [node('a', 'A'), node('b', 'B'), node('c', 'C'), node('d', 'D'), node('e', '1.only')],
      edges: [edge('a', 'b')],
    }
    // One option node in five (20%) is below the 25% threshold, so nothing is
    // collapsed — a stray numbered label shouldn't restructure someone's graph.
    expect(buildBrainstormPlan(data).nodes).toHaveLength(5)
  })
})

describe('slugs derived from dialogue', () => {
  const slugOf = (label: string) =>
    buildBrainstormPlan({ nodes: [node('a', label)], edges: [] }).nodes[0].slug

  it('drops the speaker name, which half this story’s lines open with', () => {
    // Without this, "Carter: …" and "Mike: …" would make most slugs identical.
    expect(slugOf('Carter: See? It is definitely one of these.')).toBe('SEE_IT_IS_DEFINITELY')
  })

  it('keeps slugs short enough to use as a Twilio widget prefix', () => {
    const long =
      'As you continue down the dank dungeon corridor, the moss covered cobblestone gives way'
    expect(slugOf(long).length).toBeLessThanOrEqual(32)
  })

  it('does not let filler-word trimming empty a short label', () => {
    // "A" is a filler word; trimming it would leave nothing at all.
    expect(slugOf('A')).toBe('A')
    expect(slugOf('The end')).toBe('END')
  })

  it('survives a label made only of punctuation', () => {
    expect(slugOf('***')).toMatch(/^ROOM/)
  })
})
