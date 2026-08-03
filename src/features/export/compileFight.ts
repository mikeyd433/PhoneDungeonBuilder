import type { Choice, StoryGraph, StoryNode } from '@/types/domain'
import {
  fightProblems,
  MAX_FIGHT_MOVES,
  outcomesOf,
  resolveMiss,
  resolveMove,
} from '@/features/fight/model'
import type { Fight, FightMove, FightRound } from '@/types/domain'
import { gatherProperties, type Transition, type Widget } from './compile'

/**
 * A fight, as widgets.
 *
 * Lifted out of `compileStory` because it is the one part of a room that shares
 * almost nothing with the rest of it: no gather for the room, no doors, no
 * reading chain — a fight decides where the caller goes, so the walls do not
 * get a say. What it does share is passed in explicitly rather than closed
 * over, which is the whole point: the 1,249-line compiler had a 157-line fight
 * in the middle of it and no way to read one without the other.
 *
 * Where a digit goes is `resolveMove`'s call, the same function the playtest
 * runtime asks. That is the only reason a fight can be trusted to behave on the
 * phone the way it behaves in rehearsal (principle 9).
 */
export interface FightEmitContext {
  graph: StoryGraph
  node: StoryNode
  slug: string
  /** The room's doors. A fight room having any at all is a warning. */
  outgoing: Choice[]
  fight: Fight
  moves: FightMove[]
  rounds: FightRound[]
  outcomes: ReturnType<typeof outcomesOf>
  audioBaseUrl: string
  /** Appended to, not returned — the compiler owns the lists. */
  widgets: Widget[]
  warnings: string[]
  /** The first widget a caller ENTERING a room runs — a fight with no rounds
   *  walks straight out the winning side into one. */
  entryName: (n: StoryNode) => string | null
  /** Where a fight outcome leads, falling back to the fight's own room. */
  fightOutcome: (targetId: string | null, fallback: StoryNode) => string | null
  roundName: (slug: string, index: number, part: 'play' | 'gather') => string
  roundEntry: (slug: string, rounds: Array<{ audio_path: string | null }>, i: number) => string
}

export function emitFight(ctx: FightEmitContext): void {
  const {
    graph,
    node,
    slug,
    outgoing,
    fight,
    moves,
    rounds,
    outcomes,
    audioBaseUrl,
    widgets,
    warnings,
    entryName,
    fightOutcome,
    roundName,
    roundEntry,
  } = ctx
    const view = { fight, moves, rounds, outcomes }
    const missNext = fightOutcome(resolveMiss(view), node)

    rounds.forEach((round, i) => {
      // A round is a performance, and mid-fight is the last place a robot
      // voice belongs. With no take the round says nothing and goes straight
      // to the keypad — which is wrong for the caller and reported as such,
      // but it is at least not wrong in a text-to-speech voice.
      if (round.audio_path) {
        widgets.push({
          name: roundName(slug, i, 'play'),
          type: 'say-play',
          nodeId: node.id,
          note: `Round ${i + 1}: ${fight.opponent_name} throws ${round.opponent_move || '(nothing set)'}.`,
          playUrl: `${audioBaseUrl}${round.audio_path}`,
          transitions: [{ event: 'audioComplete', next: roundName(slug, i, 'gather') }],
        })
      } else {
        warnings.push(
          `${slug} round ${i + 1} has no recording, so the caller hears nothing before answering it.`,
        )
      }

      // One transition per move — a round is a room where you pick an exit,
      // so each digit gets named its own destination and several may share
      // one. Where each goes is resolveMove's call, the same function the
      // playtest runtime asks, so the phone cannot disagree with the editor.
      const roundTransitions: Transition[] = []
      const legend: string[] = []

      moves.slice(0, MAX_FIGHT_MOVES).forEach((move, m) => {
        const outcome = resolveMove(view, i, move.id)
        const next =
          outcome.via === 'advance' && outcome.nextRound !== null
            ? roundEntry(slug, rounds, outcome.nextRound)
            : fightOutcome(outcome.nodeId, node)
        roundTransitions.push({
          event: 'match',
          condition: `Digits equals ${m + 1}`,
          match: { type: 'equal_to', value: String(m + 1) },
          next,
        })
        legend.push(`${m + 1}=${move.slug}`)
      })

      // An unmapped digit is an answer, and it is the wrong one.
      roundTransitions.push({ event: 'noMatch', next: missNext })

      // Same split as a room's keypad, and for the same reason: a gather
      // takes keypress, speech and timeout, and carries no conditions.
      widgets.push({
        name: roundName(slug, i, 'gather'),
        type: 'gather-input-on-call',
        nodeId: node.id,
        note:
          legend.length > 0
            ? `${legend.join(', ')}. Any other digit, and silence, takes the losing route.`
            : 'This round has no moves — every answer takes the losing route.',
        properties: gatherProperties(node.timeout_seconds),
        transitions: [
          { event: 'keypress', next: `${slug}_r${i + 1}_keys` },
          { event: 'speech', next: `${slug}_r${i + 1}_keys` },
          // Silence is not a wrong answer. Callers hesitate, mishear, or are
          // still working out which digit is which, so the round repeats a
          // few times before the fight is called — through a counter, because
          // routing timeout straight back at the round would run one widget
          // in a loop and Studio ends an execution after ten consecutive runs
          // of the same widget (§6.0).
          { event: 'timeout', next: `${slug}_r${i + 1}_waited` },
        ],
      })
      widgets.push({
        name: `${slug}_r${i + 1}_keys`,
        type: 'split-based-on',
        nodeId: node.id,
        note: 'Which move the caller answered with.',
        splitOn: `{{widgets.${roundName(slug, i, 'gather')}.Digits}}`,
        transitions: roundTransitions,
      })

      // Silence handling: count it, then either repeat the round or call it.
      const silenceVar = `${slug}_r${i + 1}_silence`
      widgets.push({
        name: `${slug}_r${i + 1}_waited`,
        type: 'set-variables',
        nodeId: node.id,
        note: 'The caller said nothing. Count it.',
        variables: [
          {
            key: silenceVar,
            value: `{{ flow.variables.${silenceVar} | default: 0 | plus: 1 }}`,
          },
        ],
        transitions: [{ event: 'next', next: `${slug}_r${i + 1}_patience` }],
      })
      widgets.push({
        name: `${slug}_r${i + 1}_patience`,
        type: 'split-based-on',
        nodeId: node.id,
        note: `Repeat the round up to ${fight.silence_patience} times, then the fight is called.`,
        splitOn: `{{flow.variables.${silenceVar}}}`,
        transitions: [
          {
            event: 'match',
            condition: `Less than ${fight.silence_patience}`,
            match: { type: 'less_than', value: String(fight.silence_patience) },
            next: roundEntry(slug, rounds, i),
          },
          { event: 'noMatch', next: missNext },
        ],
      })
    })

    // The counters live for the whole call, so a fight re-entered by a loop
    // would start already out of patience. Zero them on the way in.
    //
    // Emitted even for a fight with no rounds: the room's audio transitions
    // here by name, so skipping it left the flow pointing at a widget that
    // did not exist. A fight with nothing in it walks straight out the
    // winning side — and if that isn't set either, the transition goes
    // nowhere on purpose rather than looping back into this same room.
    const winner = fight.win_node_id ? graph.nodes.get(fight.win_node_id) : null
    widgets.push({
      name: `${slug}_reset`,
      type: 'set-variables',
      nodeId: node.id,
      note:
        rounds.length > 0
          ? 'Clear the silence counters, so re-entering this fight starts fresh.'
          : 'This fight has no rounds, so it is walked straight through.',
      variables: rounds.map((_, i) => ({ key: `${slug}_r${i + 1}_silence`, value: '0' })),
      transitions: [
        {
          event: 'next',
          next:
            rounds.length > 0
              ? roundEntry(slug, rounds, 0)
              : winner
                ? entryName(winner)
                : null,
        },
      ],
    })

    for (const problem of fightProblems(view)) {
      warnings.push(`${slug}: ${problem}`)
    }
    if (outgoing.length > 0) {
      warnings.push(
        `${slug} is a fight but also has ${outgoing.length} exit(s). A fight decides where the caller goes, so those doors are not exported.`,
      )
    }
}
