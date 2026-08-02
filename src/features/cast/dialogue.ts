import type { Character, DialogueLine, StoryGraph } from '@/types/domain'

/**
 * Narration in, attributed lines out — and back again.
 *
 * A room is still recorded as ONE audio file, so `nodes.narration` stays the
 * thing that gets read aloud and the thing the exporter emits. Dialogue lines
 * are a view of that same text with a speaker attached to each part, which is
 * what makes a per-actor script possible.
 *
 * The two functions here are inverses. `composeNarration(split(x)) === x` for
 * any text this module would produce, and that round-trip is the reason lines
 * can be edited without the narration and the script drifting apart: whichever
 * one you change, the other is regenerated from it rather than kept in step by
 * hand.
 */

export interface SpokenLine {
  /** As written in the text, not a slug. Null = nobody is speaking it. */
  speaker: string | null
  text: string
}

/** A speaker's name: up to three capitalised words. Longer than that and it is
 *  a sentence that happens to contain a colon. */
const LEADING_SPEAKER = /^([A-Z][A-Za-z0-9'’.-]*(?:[ \t]+[A-Z][A-Za-z0-9'’.-]*){0,2})[ \t]*:[ \t]*(.*)$/

/** Splitting an inline speaker only after sentence-ending punctuation keeps
 *  "…and then, Carter: run" from being torn apart mid-clause. */
const INLINE_SPEAKER =
  /([.!?…]["'”’)\]]?)[ \t]+([A-Z][A-Za-z0-9'’.-]*(?:[ \t]+[A-Z][A-Za-z0-9'’.-]*){0,2}[ \t]*:[ \t])/g

const MAX_SPEAKER_LENGTH = 28

/**
 * Words that end in a colon but are production directions, not people. Left
 * unattributed with the prefix intact, because a voice actor needs to see
 * "SFX: a door slams" — they just shouldn't be cast as SFX.
 */
const NOT_SPEAKERS = new Set([
  'note',
  'notes',
  'sfx',
  'fx',
  'music',
  'sound',
  'warning',
  'todo',
  'tip',
  'cue',
  'http',
  'https',
])

function isSpeakerName(name: string): boolean {
  if (name.length > MAX_SPEAKER_LENGTH) return false
  return !NOT_SPEAKERS.has(name.trim().toLowerCase())
}

/** Break a room's narration into attributed lines. */
export function splitNarration(narration: string): SpokenLine[] {
  if (!narration.trim()) return []

  // Pull inline speakers onto their own line first, so one pass over newlines
  // handles both shapes.
  const normalised = narration.replace(INLINE_SPEAKER, '$1\n$2')

  const out: SpokenLine[] = []
  for (const raw of normalised.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = LEADING_SPEAKER.exec(line)
    if (match && isSpeakerName(match[1]) && match[2].trim()) {
      out.push({ speaker: match[1].trim(), text: match[2].trim() })
    } else {
      out.push({ speaker: null, text: line })
    }
  }
  return out
}

/** The inverse: lines back into the single block of text that gets recorded. */
export function composeNarration(lines: SpokenLine[]): string {
  return (
    lines
      // Filter on the TEXT, not on the composed line: "Carter: " with nothing
      // after it is not empty as a string, but it is empty as a line, and
      // emitting it would break the round-trip — splitNarration rejects a
      // speaker with no words and would hand back a different shape.
      .filter((l) => l.text.trim().length > 0)
      .map((l) => (l.speaker ? `${l.speaker}: ${l.text.trim()}` : l.text.trim()))
      .join('\n')
  )
}

// ------------------------------------------------------------ graph helpers

/**
 * What a set of lines belongs to: a room, or a door's reaction.
 *
 * One type rather than two code paths, because the writing is the same writing
 * — split it by speaker, cast it, record it a line at a time — and the only
 * thing that differs is which column the composed text is written back to.
 */
export type LineOwner = { nodeId: string } | { choiceId: string }

export const ownerKey = (owner: LineOwner) =>
  'nodeId' in owner ? `node:${owner.nodeId}` : `choice:${owner.choiceId}`

/** An owner's stored lines, in order. */
export function linesOf(graph: StoryGraph, owner: LineOwner): DialogueLine[] {
  return [...graph.dialogue.values()]
    .filter((l) =>
      'nodeId' in owner ? l.node_id === owner.nodeId : l.choice_id === owner.choiceId,
    )
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** A node's stored lines, in order. */
export function linesFor(graph: StoryGraph, nodeId: string): DialogueLine[] {
  return linesOf(graph, { nodeId })
}

/** True when this owner's audio is assembled from its lines rather than one
 *  take. Follows the data, not a setting: one recorded line is the switch. */
export function splitsByLine(graph: StoryGraph, owner: LineOwner): boolean {
  return linesOf(graph, owner).some((l) => l.audio_path)
}

/** The single block of text an owner is recorded from, before any split. */
export function narrationOf(graph: StoryGraph, owner: LineOwner): string {
  if ('nodeId' in owner) return graph.nodes.get(owner.nodeId)?.narration ?? ''
  return graph.choices.get(owner.choiceId)?.reaction_narration ?? ''
}

/**
 * What a door's reaction plays, in order.
 *
 * Same rule as a room: one take unless the lines carry their own, in which case
 * they play back to back. An unrecorded part is silence on the phone.
 */
export function reactionPlaybackFor(graph: StoryGraph, choiceId: string): PlaybackPart[] {
  const choice = graph.choices.get(choiceId)
  if (!choice) return []

  if (!splitsByLine(graph, { choiceId })) {
    return choice.audio_path || choice.reaction_narration?.trim()
      ? [
          {
            id: choice.id,
            audioPath: choice.audio_path,
            say: choice.reaction_narration ?? '',
            speaker: null,
          },
        ]
      : []
  }

  return linesOf(graph, { choiceId }).map((line) => partOf(graph, line))
}

const partOf = (graph: StoryGraph, line: DialogueLine): PlaybackPart => ({
  id: line.id,
  audioPath: line.audio_path,
  say: line.text,
  speaker: line.character_id ? (graph.characters.get(line.character_id)?.name ?? null) : null,
})

/**
 * What a room actually plays, in order.
 *
 * A room is normally ONE recording: the narration, read by whoever was booked.
 * But a conversation between two separately-booked actors cannot be one file,
 * and that is exactly what the cast list exists for. So when the lines carry
 * their own takes, the room plays those takes back to back and then offers its
 * exits — the shape a dialogue-as-rooms chain was hand-built in, without a room
 * per line.
 *
 * The switch is per room and follows the data: any line with audio means the
 * room plays line by line. A room whose lines have no takes is unchanged.
 */
export interface PlaybackPart {
  /** Stable id: the line's, or the node's when the room plays as one piece. */
  id: string
  /** Null falls back to `say` — an unrecorded line is spoken, not skipped. */
  audioPath: string | null
  say: string
  speaker: string | null
}

export function playbackFor(graph: StoryGraph, nodeId: string): PlaybackPart[] {
  const node = graph.nodes.get(nodeId)
  if (!node) return []

  if (!splitsByLine(graph, { nodeId })) {
    return [{ id: node.id, audioPath: node.audio_path, say: node.narration, speaker: null }]
  }

  return linesFor(graph, nodeId).map((line) => partOf(graph, line))
}

/** True when a room's audio is assembled from its lines rather than one take. */
export function playsLineByLine(graph: StoryGraph, nodeId: string): boolean {
  return splitsByLine(graph, { nodeId })
}

/**
 * Is this room fully recorded?
 *
 * A room playing line by line is only done when every line has a take — one
 * recorded line out of four is a conversation with three silences in it, and
 * lighting the torch for that would be a lie (§0's first rule).
 */
export function isFullyRecorded(graph: StoryGraph, nodeId: string): boolean {
  const parts = playbackFor(graph, nodeId)
  return parts.length > 0 && parts.every((p) => Boolean(p.audioPath))
}

export function castList(graph: StoryGraph): Character[] {
  return [...graph.characters.values()].sort(
    (a, b) => Number(b.is_playable) - Number(a.is_playable) || a.name.localeCompare(b.name),
  )
}

/** Match a written name to a cast entry. Case-insensitive on both the display
 *  name and the slug, so "carter", "Carter" and "CARTER" all land on one
 *  character rather than casting three. */
export function matchCharacter(graph: StoryGraph, name: string): Character | null {
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  for (const c of graph.characters.values()) {
    if (c.name.toLowerCase() === needle || c.slug.toLowerCase() === needle) return c
  }
  return null
}

export interface CastSuggestion {
  name: string
  /** How many lines across the story this name speaks. */
  lines: number
  /** Rooms it appears in, for the "where?" column. Capped — the list is a
   *  prompt to add a character, not a concordance. */
  sampleSlugs: string[]
}

/**
 * Every name that speaks somewhere but isn't in the cast yet.
 *
 * With 143 imported rooms, typing the cast out by hand is not a real option, so
 * this reads the story back and offers what it finds.
 */
export function suggestCast(graph: StoryGraph): CastSuggestion[] {
  const found = new Map<string, CastSuggestion>()
  for (const node of graph.nodes.values()) {
    for (const line of splitNarration(node.narration)) {
      if (!line.speaker || matchCharacter(graph, line.speaker)) continue
      const key = line.speaker.toLowerCase()
      const entry = found.get(key) ?? { name: line.speaker, lines: 0, sampleSlugs: [] }
      entry.lines += 1
      if (entry.sampleSlugs.length < 4 && !entry.sampleSlugs.includes(node.slug)) {
        entry.sampleSlugs.push(node.slug)
      }
      found.set(key, entry)
    }
  }
  return [...found.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name))
}

export interface ActorWorkload {
  /** Null for lines whose character has no voice actor assigned yet. */
  actor: string | null
  characters: string[]
  lines: number
  /** Their own lines with no take yet, in rooms recorded line by line. */
  unrecordedLines: number
  /** Rooms this actor still has to show up for. */
  unrecordedSlugs: string[]
}

/**
 * Where a line lives, seen from the line rather than from the owner.
 *
 * `workloads` walks the dialogue table and has to say which room to call an
 * actor back for. A reaction has no room of its own — it happens in a doorway —
 * so it is named for the room the caller is standing in when they hear it,
 * which is the only place an actor could be pointed at.
 */
function ownerOf(
  graph: StoryGraph,
  line: DialogueLine,
): { key: string; owner: LineOwner; where: string; audioPath: string | null } | null {
  if (line.node_id) {
    const node = graph.nodes.get(line.node_id)
    if (!node) return null
    const owner = { nodeId: node.id }
    return { key: ownerKey(owner), owner, where: node.slug, audioPath: node.audio_path }
  }
  if (line.choice_id) {
    const choice = graph.choices.get(line.choice_id)
    const from = choice ? graph.nodes.get(choice.from_node_id) : null
    if (!choice || !from) return null
    const owner = { choiceId: choice.id }
    return {
      key: ownerKey(owner),
      owner,
      where: `${from.slug} (pressing ${choice.digit})`,
      audioPath: choice.audio_path,
    }
  }
  return null
}

/**
 * What each voice actor still owes.
 *
 * The unit depends on how the room records, and getting it wrong wastes
 * people's time in both directions:
 *
 *   * A room recorded as ONE file is a room the whole cast attends, so it stays
 *     outstanding for everyone in it until that single take exists. Counting
 *     lines there would have two actors each think their half was separately
 *     bookable when it isn't.
 *   * A room recorded LINE BY LINE is outstanding only for the actors whose own
 *     lines are missing. Counting the whole room there would send somebody back
 *     for a scene they finished weeks ago.
 */
export function workloads(graph: StoryGraph): ActorWorkload[] {
  const byActor = new Map<string, ActorWorkload>()
  const splitByOwner = new Map<string, boolean>()

  for (const line of graph.dialogue.values()) {
    const character = line.character_id ? graph.characters.get(line.character_id) : null
    const actor = character?.voice_actor?.trim() || null
    const key = actor ?? ' unassigned'
    const entry = byActor.get(key) ?? {
      actor,
      characters: [],
      lines: 0,
      unrecordedLines: 0,
      unrecordedSlugs: [],
    }
    entry.lines += 1
    if (character && !entry.characters.includes(character.name)) {
      entry.characters.push(character.name)
    }

    const owner = ownerOf(graph, line)
    if (owner) {
      if (!splitByOwner.has(owner.key)) splitByOwner.set(owner.key, splitsByLine(graph, owner.owner))
      const split = splitByOwner.get(owner.key)!
      if (split ? !line.audio_path : !owner.audioPath) {
        if (split) entry.unrecordedLines += 1
        if (!entry.unrecordedSlugs.includes(owner.where)) entry.unrecordedSlugs.push(owner.where)
      }
    }
    byActor.set(key, entry)
  }

  for (const entry of byActor.values()) {
    entry.characters.sort()
    entry.unrecordedSlugs.sort()
  }
  return [...byActor.values()].sort(
    (a, b) => Number(a.actor === null) - Number(b.actor === null) || b.lines - a.lines,
  )
}
