import type { StoryGraph } from '@/types/domain'
import { buildFightView } from '@/features/fight/model'
import { linesFor } from '@/features/cast/dialogue'

/**
 * Every slot in a story that somebody could record, named the same way twice.
 *
 * The point of naming is the round trip: the audio manifest tells an actor
 * exactly what to call each file, and the bulk importer matches what comes back
 * by that same name. Two lists that agreed only by convention would drift the
 * first time a kind was added, so both read this one.
 *
 * `#` reads well in a spreadsheet and is miserable in a filename, so the file
 * name uses `__`.
 */

export type TargetKind =
  | 'room'
  | 'line'
  | 'fight round'
  | 'reaction'
  | 'refusal'
  | 'item'
  | 'inventory'

export interface AudioTarget {
  /** Stable identity for this slot, and what the manifest shows. */
  key: string
  kind: TargetKind
  /** What to call the file. Extension-free; any audio format is accepted. */
  file: string
  /** For the review table: what is being said, and by whom. */
  label: string
  text: string
  /** Where the take is now, if there is one. */
  currentPath: string | null
  currentDurationMs: number | null
  /** Whatever the importer needs to write it back. */
  ref:
    | { kind: 'room'; nodeId: string }
    | { kind: 'line'; lineId: string }
    | { kind: 'fight round'; roundId: string }
    | { kind: 'reaction'; choiceId: string }
    | { kind: 'refusal'; gateId: string; choiceId: string }
    | { kind: 'item'; varId: string }
    | { kind: 'inventory'; slot: 'intro' | 'empty' }
}

export function audioTargets(graph: StoryGraph): AudioTarget[] {
  const out: AudioTarget[] = []

  for (const node of [...graph.nodes.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const lines = linesFor(graph, node.id)
    // A room split into lines has no take of its own worth chasing: what it
    // plays is the lines, one after another.
    const split = lines.some((l) => l.audio_path) || lines.length > 0

    if (!split) {
      out.push({
        key: node.slug,
        kind: 'room',
        file: node.slug,
        label: node.title || node.slug,
        text: node.narration,
        currentPath: node.audio_path,
        currentDurationMs: node.audio_duration_ms,
        ref: { kind: 'room', nodeId: node.id },
      })
    } else {
      lines.forEach((line, i) => {
        const who = line.character_id ? graph.characters.get(line.character_id) : null
        out.push({
          key: `${node.slug}#${i + 1}`,
          kind: 'line',
          file: `${node.slug}__line${i + 1}`,
          label: who?.name ? `${node.slug} — ${who.name}` : node.slug,
          text: line.text,
          currentPath: line.audio_path,
          currentDurationMs: line.audio_duration_ms,
          ref: { kind: 'line', lineId: line.id },
        })
      })
    }

    const fight = buildFightView(graph, node.id)
    if (fight) {
      fight.rounds.forEach((round, i) => {
        out.push({
          key: `${node.slug}#r${i + 1}`,
          kind: 'fight round',
          file: `${node.slug}__r${i + 1}`,
          label: `${node.slug} — ${fight.fight.opponent_name}, round ${i + 1}`,
          text: round.narration,
          currentPath: round.audio_path,
          currentDurationMs: round.audio_duration_ms,
          ref: { kind: 'fight round', roundId: round.id },
        })
      })
    }
  }

  // A door's reaction: the moment between pressing and arriving.
  for (const choice of [...graph.choices.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!choice.reaction_narration?.trim() && !choice.audio_path) continue
    const from = graph.nodes.get(choice.from_node_id)
    if (!from) continue
    out.push({
      key: `${from.slug}#d${choice.digit}react`,
      kind: 'reaction',
      file: `${from.slug}__d${choice.digit}__react`,
      label: `${from.slug} — reacting to ${choice.label || `digit ${choice.digit}`}`,
      text: choice.reaction_narration ?? '',
      currentPath: choice.audio_path,
      currentDurationMs: choice.audio_duration_ms,
      ref: { kind: 'reaction', choiceId: choice.id },
    })
  }

  for (const gate of graph.gates.values()) {
    if (gate.fail_behavior !== 'refuse') continue
    const choice = graph.choices.get(gate.choice_id)
    const from = choice ? graph.nodes.get(choice.from_node_id) : null
    if (!choice || !from) continue
    out.push({
      key: `${from.slug}#d${choice.digit}`,
      kind: 'refusal',
      file: `${from.slug}__d${choice.digit}`,
      label: `${from.slug} — refusing digit ${choice.digit}`,
      text: gate.fail_narration ?? '',
      currentPath: gate.fail_audio_path,
      currentDurationMs: gate.fail_audio_duration_ms,
      ref: { kind: 'refusal', gateId: gate.id, choiceId: gate.choice_id },
    })
  }

  // Only when the story has a readback: an item's name is worth recording
  // precisely because something reads it out.
  if (graph.story.inventory_key) {
    out.push({
      key: 'inventory#intro',
      kind: 'inventory',
      file: 'inventory__intro',
      label: 'Inventory lead-in',
      text: 'You are carrying…',
      currentPath: graph.story.inventory_intro_audio_path,
      currentDurationMs: graph.story.inventory_intro_audio_duration_ms,
      ref: { kind: 'inventory', slot: 'intro' },
    })
    out.push({
      key: 'inventory#empty',
      kind: 'inventory',
      file: 'inventory__empty',
      label: 'Inventory, empty handed',
      text: 'You are carrying nothing.',
      currentPath: graph.story.inventory_empty_audio_path,
      currentDurationMs: graph.story.inventory_empty_audio_duration_ms,
      ref: { kind: 'inventory', slot: 'empty' },
    })
    for (const v of [...graph.stateVars.values()]
      .filter((v) => v.kind === 'item')
      .sort((a, b) => a.slug.localeCompare(b.slug))) {
      out.push({
        key: `item#${v.slug}`,
        kind: 'item',
        file: `item__${v.slug}`,
        label: `Item — ${v.name || v.slug}`,
        text: v.name || v.slug,
        currentPath: v.audio_path,
        currentDurationMs: v.audio_duration_ms,
        ref: { kind: 'item', varId: v.id },
      })
    }
  }

  return out
}

/**
 * A filename, reduced to something comparable.
 *
 * Actors and studios add things: a take number, a duplicate marker from the
 * download folder, a stray space. None of that changes which line it is, and
 * rejecting a file over it would mean renaming by hand — which is exactly the
 * work this is meant to remove.
 */
export function normaliseFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '') // extension
    .replace(/\s*\(\d+\)$/, '') // "(1)" from a second download
    .replace(/[\s_-]*take[\s_-]*\d+$/i, '') // "take 3", "_take3", "-TAKE-3"
    .replace(/[\s_-]*v\d+$/i, '') // "v2"
    .trim()
    .toUpperCase()
}

/** Which slot a dropped file belongs to, or null if nothing claims it. */
export function matchFile(targets: AudioTarget[], fileName: string): AudioTarget | null {
  const wanted = normaliseFileName(fileName)
  return targets.find((t) => normaliseFileName(t.file) === wanted) ?? null
}
