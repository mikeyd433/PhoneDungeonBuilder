import type { DerivedGraph, StoryGraph } from '@/types/domain'
import { audioTargets, type AudioTarget } from '@/features/audio/targets'
import { inStoryOrder, roomOf } from '@/features/audio/queue'

/**
 * What one voice actor has to turn up and read.
 *
 * The audio manifest is one flat list of every slot in the story, which is the
 * right thing to hold against a returned folder and the wrong thing to hand a
 * person: an actor booked for two hours needs their own lines, in the order the
 * story is read, with the filename each take has to come back as — and nothing
 * else, because everything else is somebody else's job.
 *
 * Built over `audioTargets` rather than over `dialogue_lines` so that the
 * filenames here are the same strings the bulk importer matches on. A call
 * sheet asking for a name the importer does not recognise is worse than no call
 * sheet at all.
 */

export interface CallSheetLine {
  /** What to call the file that comes back. */
  file: string
  /** Where it is heard, for the actor's own bearings. */
  where: string
  text: string
  /** Already recorded — kept, greyed, so a second session knows what to skip. */
  done: boolean
  seconds: number
}

export interface CallSheet {
  /** Null for lines whose character has no voice actor assigned yet. */
  actor: string | null
  characters: string[]
  lines: CallSheetLine[]
  outstanding: number
  /** Rough running time of what is still to record. */
  outstandingSeconds: number
}

/** Roughly how long a line takes to say. Matches lib/speech's estimate. */
const WORDS_PER_MINUTE = 150
const seconds = (text: string) =>
  Math.max(1, Math.round((text.trim().split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE) * 60))

/** Which character speaks a slot, if any. Only lines are cast; a room read as
 *  one block is whoever is booked for the room, which nothing records. */
function speakerOf(graph: StoryGraph, target: AudioTarget): string | null {
  if (target.ref.kind !== 'line') return null
  const line = graph.dialogue.get(target.ref.lineId)
  return line?.character_id ?? null
}

export function callSheets(graph: StoryGraph, derived: DerivedGraph): CallSheet[] {
  const ordered = inStoryOrder(audioTargets(graph), graph, derived)
  const byActor = new Map<string, CallSheet>()

  for (const target of ordered) {
    const characterId = speakerOf(graph, target)
    if (!characterId) continue
    const character = graph.characters.get(characterId)
    if (!character) continue

    const actor = character.voice_actor?.trim() || null
    // Grouped by ACTOR, not by character: one person often plays two, and
    // sending them two separate call sheets for the same session is how a
    // booking gets double-counted.
    const key = actor ?? ' unassigned'
    const sheet = byActor.get(key) ?? {
      actor,
      characters: [],
      lines: [],
      outstanding: 0,
      outstandingSeconds: 0,
    }
    if (!sheet.characters.includes(character.name)) sheet.characters.push(character.name)

    const roomId = roomOf(graph, target)
    const node = roomId ? graph.nodes.get(roomId) : null
    const done = Boolean(target.currentPath)
    const secs = seconds(target.text)

    sheet.lines.push({
      file: target.file,
      where: node ? node.title || node.slug : '—',
      text: target.text,
      done,
      seconds: secs,
    })
    if (!done) {
      sheet.outstanding += 1
      sheet.outstandingSeconds += secs
    }
    byActor.set(key, sheet)
  }

  for (const sheet of byActor.values()) sheet.characters.sort()
  return [...byActor.values()].sort(
    // Unassigned last: it is a casting problem, not a session.
    (a, b) =>
      Number(a.actor === null) - Number(b.actor === null) ||
      b.outstanding - a.outstanding ||
      (a.actor ?? '').localeCompare(b.actor ?? ''),
  )
}

/** The sheet as plain text, for pasting into an email or printing. */
export function callSheetText(sheet: CallSheet, storyTitle: string): string {
  const who = sheet.actor ?? 'Unassigned'
  const out = [
    `${storyTitle} — call sheet for ${who}`,
    `Playing: ${sheet.characters.join(', ')}`,
    `${sheet.outstanding} still to record (~${Math.ceil(sheet.outstandingSeconds / 60)} min of speech)`,
    '',
    'Name each file exactly as shown. Any format is fine — it gets converted on the way in.',
    '',
  ]
  for (const line of sheet.lines) {
    if (line.done) continue
    out.push(`[${line.file}]  (${line.where})`)
    out.push(line.text.trim())
    out.push('')
  }
  return out.join('\n')
}
