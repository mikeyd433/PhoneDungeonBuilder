import type { Choice, Digit, Gate, StateVar, Story, StoryGraph, StoryNode } from '@/types/domain'

/**
 * Test helper for building a StoryGraph without a database.
 *
 * `edges` uses a compact "FROM>TO" notation, or "FROM>" for a bricked archway.
 * Digits are assigned 1,2,3… per source node in listed order, which mirrors what
 * the CSV importer does for sheets that have no digits.
 */
export function makeGraph(
  slugs: string[],
  edges: string[],
  opts: {
    root?: string
    endings?: string[]
    recorded?: string[]
  } = {},
): StoryGraph {
  const story: Story = {
    id: 'story-1',
    title: 'Test Story',
    root_node_id: null,
    owner_id: 'user-1',
    counter_clamp: 10,
    default_fail_behavior: 'refuse',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  const nodes = new Map<string, StoryNode>()
  const bySlug = new Map<string, string>()
  slugs.forEach((slug, i) => {
    const id = `n${i + 1}`
    bySlug.set(slug, id)
    nodes.set(id, {
      id,
      story_id: story.id,
      slug,
      title: slug,
      narration: '',
      node_type: opts.endings?.includes(slug) ? 'ending' : 'room',
      audio_path: opts.recorded?.includes(slug) ? `audio/${slug}.mp3` : null,
      audio_duration_ms: null,
      status: opts.recorded?.includes(slug) ? 'recorded' : 'stub',
      notes: null,
      timeout_target_id: null,
      invalid_target_id: null,
      timeout_seconds: 5,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
  })

  story.root_node_id = bySlug.get(opts.root ?? slugs[0]) ?? null

  const choices = new Map<string, Choice>()
  const digitCounter = new Map<string, number>()
  edges.forEach((edge, i) => {
    const [fromSlug, toSlug] = edge.split('>')
    const fromId = bySlug.get(fromSlug)
    if (!fromId) throw new Error(`unknown node in edge: ${edge}`)
    const n = (digitCounter.get(fromId) ?? 0) + 1
    digitCounter.set(fromId, n)
    const id = `c${i + 1}`
    choices.set(id, {
      id,
      story_id: story.id,
      from_node_id: fromId,
      digit: String(n) as Digit,
      label: toSlug ? `to ${toSlug}` : 'unwritten',
      to_node_id: toSlug ? (bySlug.get(toSlug) ?? null) : null,
      sort_order: n,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
  })

  return {
    story,
    nodes,
    choices,
    stateVars: new Map<string, StateVar>(),
    effects: new Map(),
    gates: new Map<string, Gate>(),
  }
}

/** Resolve a slug to its generated node id, for assertions. */
export function idOf(graph: StoryGraph, slug: string): string {
  for (const node of graph.nodes.values()) if (node.slug === slug) return node.id
  throw new Error(`no node with slug ${slug}`)
}

/** Resolve an edge "FROM>TO" to its generated choice id, for assertions. */
export function choiceOf(graph: StoryGraph, from: string, to: string): string {
  const fromId = idOf(graph, from)
  const toId = idOf(graph, to)
  for (const c of graph.choices.values()) {
    if (c.from_node_id === fromId && c.to_node_id === toId) return c.id
  }
  throw new Error(`no choice ${from}>${to}`)
}
