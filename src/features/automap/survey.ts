import type { DerivedGraph, StoryGraph } from '@/types/domain'
import { isFullyRecorded, linesOf } from '@/features/cast/dialogue'

/**
 * What the map should be able to tell you at a glance.
 *
 * The map screen knew one number — how many rooms — which is the least useful
 * fact about a 139-room dungeon. These are the ones you actually open the map
 * to find out: how much is written, how much is recorded, and what is broken.
 *
 * Every count comes with the set of rooms behind it, so a tally can be tapped
 * to light those rooms up rather than sending you hunting for them. A number
 * you cannot act on is decoration, and §0's first rule forbids decoration.
 */

export type SurveyKey =
  | 'recorded'
  | 'written'
  | 'stub'
  | 'ending'
  | 'fight'
  | 'unreachable'
  | 'unwritten'

export interface SurveyBand {
  key: SurveyKey
  /** Plural label for the tally strip, and the singular for when there is one
   *  — "1 loose doors" reads like a bug in a strip whose whole job is to be
   *  read at a glance. */
  label: string
  one: string
  /** One line saying what it means and why it matters. */
  hint: string
  ids: Set<string>
}

export interface Survey {
  rooms: number
  bands: SurveyBand[]
  /** Doors with a label and nowhere to go. Counted as choices, not rooms — one
   *  room can have three of them — but attributed to the room they leave. */
  unwrittenBranches: number
  /** How much of the story has a take: the fraction the torch metaphor means. */
  recordedFraction: number
}

/**
 * Rooms matching what you typed.
 *
 * Over the narration as well as the name, because in a story imported from a
 * flowchart you remember a room by what happens in it — "the one where Tony
 * skates away" — long before you remember what it ended up called.
 */
export function findRooms(graph: StoryGraph, query: string): Set<string> | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  const hits = new Set<string>()
  for (const node of graph.nodes.values()) {
    const haystack = `${node.title} ${node.slug} ${node.narration}`.toLowerCase()
    if (haystack.includes(needle)) hits.add(node.id)
  }
  for (const line of graph.dialogue.values()) {
    if (line.node_id && line.text.toLowerCase().includes(needle)) hits.add(line.node_id)
  }
  return hits
}

export function surveyStory(graph: StoryGraph, derived: DerivedGraph): Survey {
  const recorded = new Set<string>()
  const written = new Set<string>()
  const stub = new Set<string>()
  const ending = new Set<string>()
  const unreachable = new Set<string>()

  for (const node of graph.nodes.values()) {
    // "Written" means there is something for a caller to hear — either the
    // room's own narration, or lines standing in for it.
    const hasWords =
      node.narration.trim().length > 0 || linesOf(graph, { nodeId: node.id }).length > 0

    if (isFullyRecorded(graph, node.id)) recorded.add(node.id)
    else if (hasWords) written.add(node.id)
    else stub.add(node.id)

    if (node.node_type === 'ending') ending.add(node.id)
    // Orphans are folded in here on purpose: to an author they are the same
    // problem — a room no caller will ever stand in — and two near-identical
    // tallies side by side would just be two things to squint at.
    if (derived.unreachable.has(node.id) || derived.orphans.has(node.id)) unreachable.add(node.id)
  }

  const fight = new Set([...graph.fights.values()].map((f) => f.node_id))

  const unwritten = new Set<string>()
  let unwrittenBranches = 0
  for (const choice of graph.choices.values()) {
    if (choice.to_node_id) continue
    unwrittenBranches += 1
    unwritten.add(choice.from_node_id)
  }

  const bands: SurveyBand[] = [
    {
      key: 'recorded',
      label: 'recorded',
      one: 'recorded',
      hint: 'Every part has a take. These are the rooms that are done.',
      ids: recorded,
    },
    {
      key: 'written',
      label: 'written',
      one: 'written',
      hint: 'Words but no take yet — silence on the phone until somebody reads them.',
      ids: written,
    },
    {
      key: 'stub',
      label: 'empty',
      one: 'empty',
      hint: 'Nothing written here at all.',
      ids: stub,
    },
    {
      key: 'unwritten',
      label: 'loose doors',
      one: 'loose door',
      hint: 'Rooms with a door that leads nowhere yet. That key does nothing on the phone.',
      ids: unwritten,
    },
    {
      key: 'unreachable',
      label: 'sealed',
      one: 'sealed',
      hint: 'No path from the entrance reaches these. A caller can never get here.',
      ids: unreachable,
    },
    {
      key: 'ending',
      label: 'endings',
      one: 'ending',
      hint: 'The call is read out and then hung up.',
      ids: ending,
    },
    {
      key: 'fight',
      label: 'fights',
      one: 'fight',
      hint: 'Rounds of keypresses instead of doors.',
      ids: fight,
    },
  ]

  const rooms = graph.nodes.size
  return {
    rooms,
    bands,
    unwrittenBranches,
    recordedFraction: rooms === 0 ? 0 : recorded.size / rooms,
  }
}
