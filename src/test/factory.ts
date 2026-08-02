import type {
  Character,
  Choice,
  DialogueLine,
  Digit,
  Fight,
  FightMove,
  FightRound,
  FightRoundOutcome,
  Gate,
  StateVar,
  Story,
  StoryGraph,
  StoryNode,
} from '@/types/domain'

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
    inventory_key: null,
    inventory_intro_audio_path: null,
    inventory_intro_audio_duration_ms: null,
    inventory_empty_audio_path: null,
    inventory_empty_audio_duration_ms: null,
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
      room_design: 'stone',
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
      reaction_narration: null,
      audio_path: null,
      audio_duration_ms: null,
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
    characters: new Map<string, Character>(),
    dialogue: new Map<string, DialogueLine>(),
    fights: new Map<string, Fight>(),
    fightMoves: new Map<string, FightMove>(),
    fightRounds: new Map<string, FightRound>(),
    fightOutcomes: new Map<string, FightRoundOutcome>(),
  }
}

const STAMP = '2026-01-01T00:00:00Z'

/**
 * Hang a fight off a room.
 *
 * `moves` is "SLUG beats OPPONENT MOVE" and `rounds` is the opponent's move for
 * each round in order — the two halves of the shark fight, in the shortest
 * notation that still says which answer is right.
 */
export function addFight(
  graph: StoryGraph,
  atSlug: string,
  opts: {
    moves: string[]
    rounds: string[]
    win?: string
    lose?: string
    opponent?: string
    patience?: number
    /** Give every round a take, so the fight exports without gaps. */
    recorded?: boolean
  },
): Fight {
  const nodeId = idOf(graph, atSlug)
  const fight: Fight = {
    id: `f-${atSlug}`,
    story_id: graph.story.id,
    node_id: nodeId,
    opponent_name: opts.opponent ?? 'The shark',
    win_node_id: opts.win ? idOf(graph, opts.win) : null,
    lose_node_id: opts.lose ? idOf(graph, opts.lose) : null,
    silence_patience: opts.patience ?? 3,
    created_at: STAMP,
    updated_at: STAMP,
  }
  graph.fights.set(fight.id, fight)

  opts.moves.forEach((spec, i) => {
    const [slug, beats] = spec.split(' beats ')
    const id = `${fight.id}-m${i}`
    graph.fightMoves.set(id, {
      id,
      story_id: graph.story.id,
      fight_id: fight.id,
      slug,
      label: slug.toLowerCase(),
      beats: beats ?? null,
      sort_order: i,
      created_at: STAMP,
    })
  })

  opts.rounds.forEach((opponentMove, i) => {
    const id = `${fight.id}-r${i}`
    graph.fightRounds.set(id, {
      id,
      story_id: graph.story.id,
      fight_id: fight.id,
      sort_order: i,
      opponent_move: opponentMove,
      narration: `The shark throws a ${opponentMove}.`,
      audio_path: opts.recorded ? `audio/round-${atSlug}-${i}.mp3` : null,
      audio_duration_ms: opts.recorded ? 1500 : null,
      created_at: STAMP,
      updated_at: STAMP,
    })
  })

  return fight
}

/**
 * Name where one move goes in one round, overriding the counter rule.
 *
 * `round` and `move` are indexes, because that is how the keypad sees them.
 * A null `toSlug` is a branch written but not wired.
 */
export function setOutcome(
  graph: StoryGraph,
  atSlug: string,
  round: number,
  move: number,
  toSlug: string | null,
): FightRoundOutcome {
  const fight = [...graph.fights.values()].find((f) => f.node_id === idOf(graph, atSlug))
  if (!fight) throw new Error(`no fight at ${atSlug}`)
  const id = `${fight.id}-o${round}-${move}`
  const outcome: FightRoundOutcome = {
    id,
    story_id: graph.story.id,
    fight_id: fight.id,
    round_id: `${fight.id}-r${round}`,
    move_id: `${fight.id}-m${move}`,
    to_node_id: toSlug ? idOf(graph, toSlug) : null,
    created_at: STAMP,
    updated_at: STAMP,
  }
  graph.fightOutcomes.set(id, outcome)
  return outcome
}

/** Add a cast entry. */
export function addCharacter(
  graph: StoryGraph,
  slug: string,
  patch: Partial<Character> = {},
): Character {
  const character: Character = {
    id: `ch-${slug}`,
    story_id: graph.story.id,
    slug,
    name: patch.name ?? slug[0] + slug.slice(1).toLowerCase(),
    is_playable: false,
    voice_actor: null,
    color: 'parchment',
    notes: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...patch,
  }
  graph.characters.set(character.id, character)
  return character
}

/** Attach lines to a room. `"CARTER|line text"` attributes; plain text doesn't.
 *  `recorded` gives every line its own take, which is what turns a room into a
 *  line-by-line conversation rather than one file. */
export function addLines(
  graph: StoryGraph,
  atSlug: string,
  lines: string[],
  opts: { recorded?: boolean } = {},
): DialogueLine[] {
  const nodeId = idOf(graph, atSlug)
  const recorded = opts.recorded ?? false
  return lines.map((spec, i) => {
    const [maybeSlug, ...rest] = spec.split('|')
    const attributed = rest.length > 0
    const character = attributed
      ? [...graph.characters.values()].find((c) => c.slug === maybeSlug)
      : undefined
    const line: DialogueLine = {
      id: `dl-${atSlug}-${i}`,
      story_id: graph.story.id,
      node_id: nodeId,
      choice_id: null,
      character_id: character?.id ?? null,
      text: attributed ? rest.join('|') : spec,
      sort_order: i,
      audio_path: recorded ? `audio/line-${atSlug}-${i}.mp3` : null,
      audio_duration_ms: recorded ? 2000 : null,
      created_at: STAMP,
      updated_at: STAMP,
    }
    graph.dialogue.set(line.id, line)
    return line
  })
}

/** Attach lines to a door's reaction — the same writing as a room's, on the
 *  other kind of owner. Same `"CARTER|text"` shape as `addLines`. */
export function addReactionLines(
  graph: StoryGraph,
  choiceId: string,
  lines: string[],
  opts: { recorded?: boolean } = {},
): DialogueLine[] {
  const recorded = opts.recorded ?? false
  return lines.map((spec, i) => {
    const [maybeSlug, ...rest] = spec.split('|')
    const attributed = rest.length > 0
    const character = attributed
      ? [...graph.characters.values()].find((c) => c.slug === maybeSlug)
      : undefined
    const line: DialogueLine = {
      id: `dl-${choiceId}-${i}`,
      story_id: graph.story.id,
      node_id: null,
      choice_id: choiceId,
      character_id: character?.id ?? null,
      text: attributed ? rest.join('|') : spec,
      sort_order: i,
      audio_path: recorded ? `audio/react-${choiceId}-${i}.mp3` : null,
      audio_duration_ms: recorded ? 2000 : null,
      created_at: STAMP,
      updated_at: STAMP,
    }
    graph.dialogue.set(line.id, line)
    return line
  })
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
