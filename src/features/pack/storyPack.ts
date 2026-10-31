import type { GateExpression, GateFailBehavior, StoryGraph } from '@/types/domain'
import { playbackFor, reactionPlaybackFor, type PlaybackPart } from '@/features/cast/dialogue'
import { clipFor } from '@/features/state/itemClips'
import { movesOf, roundsOf, outcomesOf } from '@/features/fight/model'

/**
 * A story pack: one story, as the Android player needs it.
 *
 * The car app is a native renderer with a Kotlin engine (`android/engine`), and
 * the two engines must play a story identically — §0's "playtest and export must
 * agree", now with a third party at the table. So the split is deliberate:
 *
 *   - WHAT IS HEARD is worked out here, by the same functions the playtest and
 *     the exporter already use (`playbackFor`, `reactionPlaybackFor`,
 *     `clipFor`). Dialogue splitting, speaker names and item clips never get a
 *     second implementation.
 *   - WHAT HAPPENS — gates, effects, consumption, fights, timeouts — is the
 *     engine's job, and `android/engine` ports `PlaytestEngine` for it.
 *
 * Everything that `PlaytestEngine` reads in a particular ORDER is written in
 * that order here (vars in insertion order, because that is how bits are
 * assigned; effects already sorted; fight moves already sorted), so the Kotlin
 * side never has to reproduce a sort and get a tie the other way round.
 *
 * `golden.test.ts` records sessions from `PlaytestEngine` over packs built by
 * this file; the Kotlin tests replay them. Change either engine and the other
 * one's tests say so.
 */

export const PACK_FORMAT = 'jackie-story-pack'
export const PACK_VERSION = 1

export interface PackPart {
  id: string
  /** A playable URL (or, in the golden fixtures, the raw storage path). */
  audio: string | null
  say: string
  speaker: string | null
}

export interface PackEffect {
  var: string
  op: 'grant' | 'revoke' | 'set' | 'add'
  amount: number | null
}

export interface PackVar {
  slug: string
  name: string
  kind: 'item' | 'flag' | 'counter'
  consumable: boolean
  /** A take of the item's name, for the readback. */
  nameAudio: string | null
  gain: PackPart | null
  spend: PackPart | null
}

export interface PackGate {
  expression: GateExpression
  fail: GateFailBehavior
  /** The refusal, as heard. Null when nothing is written or recorded. */
  failNarration: string | null
  failAudio: string | null
  failNode: string | null
  consumeOnPass: boolean
}

export interface PackChoice {
  id: string
  from: string
  digit: string
  label: string
  to: string | null
  sortOrder: number
  effects: PackEffect[]
  reaction: PackPart[]
  gate: PackGate | null
}

export interface PackFight {
  id: string
  opponent: string
  win: string | null
  lose: string | null
  patience: number
  /** Keypad order: index 0 is digit 1. */
  moves: Array<{ id: string; slug: string; label: string; beats: string | null }>
  rounds: Array<{ id: string; opponentMove: string; narration: string; audio: string | null }>
  /** Keyed `roundId:moveId`, last row wins — as the TS Map does. */
  outcomes: Array<{ round: string; move: string; to: string | null }>
}

export interface PackNode {
  id: string
  slug: string
  title: string
  ending: boolean
  endingKind: 'death' | 'win' | null
  invalidTarget: string | null
  timeoutTarget: string | null
  timeoutSeconds: number
  playback: PackPart[]
  effects: PackEffect[]
  fight: PackFight | null
}

export interface StoryPack {
  format: typeof PACK_FORMAT
  version: typeof PACK_VERSION
  title: string
  root: string | null
  counterClamp: number
  inventoryKey: '*' | '#' | null
  inventoryIntroAudio: string | null
  inventoryEmptyAudio: string | null
  vars: PackVar[]
  nodes: PackNode[]
  choices: PackChoice[]
}

/** Turns a storage path into something the phone can stream. */
export type AudioResolver = (path: string) => string

export function buildStoryPack(graph: StoryGraph, resolve: AudioResolver = (p) => p): StoryPack {
  const url = (path: string | null | undefined) => (path ? resolve(path) : null)
  const part = (p: PlaybackPart): PackPart => ({
    id: p.id,
    audio: url(p.audioPath),
    say: p.say,
    speaker: p.speaker,
  })

  const slugOf = (varId: string) => graph.stateVars.get(varId)?.slug ?? ''
  const effectsWhere = (pred: (e: { node_id: string | null; choice_id: string | null }) => boolean) =>
    [...graph.effects.values()]
      .filter(pred)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map<PackEffect>((e) => ({ var: slugOf(e.state_var_id), op: e.operation, amount: e.amount }))
      .filter((e) => e.var)

  const vars = [...graph.stateVars.values()].map<PackVar>((v) => {
    const gain = clipFor(v, 'gain')
    const spend = clipFor(v, 'spend')
    return {
      slug: v.slug,
      name: v.name,
      kind: v.kind,
      consumable: v.is_consumable,
      nameAudio: url(v.audio_path),
      gain: gain ? part(gain) : null,
      spend: spend ? part(spend) : null,
    }
  })

  const fightAt = (nodeId: string): PackFight | null => {
    const fight = [...graph.fights.values()].find((f) => f.node_id === nodeId)
    if (!fight) return null
    return {
      id: fight.id,
      opponent: fight.opponent_name,
      win: fight.win_node_id,
      lose: fight.lose_node_id,
      patience: fight.silence_patience,
      moves: movesOf(graph, fight.id).map((m) => ({ id: m.id, slug: m.slug, label: m.label, beats: m.beats })),
      rounds: roundsOf(graph, fight.id).map((r) => ({
        id: r.id,
        opponentMove: r.opponent_move,
        narration: r.narration,
        audio: url(r.audio_path),
      })),
      outcomes: [...outcomesOf(graph, fight.id).values()].map((o) => ({
        round: o.round_id,
        move: o.move_id,
        to: o.to_node_id,
      })),
    }
  }

  const nodes = [...graph.nodes.values()].map<PackNode>((n) => ({
    id: n.id,
    slug: n.slug,
    title: n.title,
    ending: n.node_type === 'ending',
    endingKind: n.node_type === 'ending' ? (n.ending_kind ?? 'death') : null,
    invalidTarget: n.invalid_target_id,
    timeoutTarget: n.timeout_target_id,
    timeoutSeconds: n.timeout_seconds,
    playback: playbackFor(graph, n.id).map(part),
    effects: effectsWhere((e) => e.node_id === n.id),
    fight: fightAt(n.id),
  }))

  const choices = [...graph.choices.values()].map<PackChoice>((c) => {
    const gate = [...graph.gates.values()].find((g) => g.choice_id === c.id)
    return {
      id: c.id,
      from: c.from_node_id,
      digit: c.digit,
      label: c.label,
      to: c.to_node_id,
      sortOrder: c.sort_order,
      effects: effectsWhere((e) => e.choice_id === c.id),
      reaction: reactionPlaybackFor(graph, c.id).map(part),
      gate: gate
        ? {
            expression: gate.expression,
            fail: gate.fail_behavior,
            failNarration: gate.fail_narration,
            failAudio: url(gate.fail_audio_path),
            failNode: gate.fail_node_id,
            consumeOnPass: gate.consume_on_pass,
          }
        : null,
    }
  })

  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    title: graph.story.title,
    root: graph.story.root_node_id,
    counterClamp: graph.story.counter_clamp,
    inventoryKey: graph.story.inventory_key,
    inventoryIntroAudio: url(graph.story.inventory_intro_audio_path),
    inventoryEmptyAudio: url(graph.story.inventory_empty_audio_path),
    vars,
    nodes,
    choices,
  }
}
