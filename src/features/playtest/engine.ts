import type { Choice, StoryGraph } from '@/types/domain'
import {
  buildFightView,
  MAX_FIGHT_MOVES,
  resolveMiss,
  resolveMove,
  type FightView,
} from '@/features/fight/model'
import {
  applyEffects,
  buildVarIndex,
  emptyState,
  evaluate,
  type CallerState,
  type EffectLike,
  type VarIndex,
} from '@/features/state/expression'
import { consumedBy } from '@/features/state/consume'
import { clipsFor, spendClips } from '@/features/state/itemClips'
import { playbackFor, reactionPlaybackFor, type PlaybackPart } from '@/features/cast/dialogue'

/**
 * The playtest runtime (§4.4) — the same data, seen as the caller sees it.
 *
 * Deliberately reuses the solver's expression evaluator and effect application
 * rather than reimplementing them. If playtest and the solver disagreed about
 * what a gate means, one of them would be lying, and the bug would only surface
 * on the phone.
 */

export interface OfferedChoice {
  choice: Choice
  /** Whether the gate passes right now. */
  open: boolean
  /** Spoken to the caller. A `hide` gate that fails is not offered at all. */
  label: string
  gate: {
    failBehavior: 'hide' | 'refuse' | 'divert'
    failNarration: string | null
    failNodeId: string | null
    consumeOnPass: boolean
  } | null
}

export interface PlaytestState {
  nodeId: string
  caller: CallerState
  /** Slugs visited, in order — the exportable path log (F5.6). */
  path: string[]
  /** Consecutive failed attempts at this node, for the patience valve (§6.3). */
  failedAttempts: number
  finished: boolean
  /** Which round of the fight the caller is in, or null when this isn't one. */
  fightRound: number | null
  /** Consecutive silences in the current round. Resets on any keypress and on
   *  entering a new round, exactly as the exported counter does. */
  fightSilences: number
}

/**
 * Everything the caller hears in one turn, in the order they hear it.
 *
 * ONE list, and this is the point of it. The reaction to a keypress, the room
 * behind the door and the round that follows a fight used to reach the screen
 * by two different routes: the engine returned a string for the transcript,
 * and the playtest screen separately watched the current room and played THAT.
 * They disagreed, and the thing that fell down the crack was the door
 * reaction — printed in the log and never once played aloud, because the only
 * branch that spoke it was the branch where the caller had not moved, and
 * walking through a door always moves you.
 *
 * So the engine says what is heard, and the screen plays exactly that. Same
 * reason `resolveMove` is shared with the exporter: two answers to one
 * question is a bug waiting for a phone call.
 */
export interface Turn {
  next: PlaytestState
  heard: PlaybackPart[]
}

/** Something the caller hears that no take exists for — a note, a refusal
 *  nobody recorded, the app talking rather than the story. */
function said(id: string, text: string, speaker: string | null = null): PlaybackPart {
  return { id, audioPath: null, say: text, speaker }
}

/** One move the caller can answer a round with, as the keypad hint shows it. */
export interface FightOption {
  digit: string
  slug: string
  label: string
}

export class PlaytestEngine {
  readonly index: VarIndex
  private graph: StoryGraph

  constructor(graph: StoryGraph) {
    this.graph = graph
    this.index = buildVarIndex(
      [...graph.stateVars.values()].map((v) => ({ slug: v.slug, kind: v.kind })),
      graph.story.counter_clamp,
    )
  }

  start(): PlaytestState {
    const rootId = this.graph.story.root_node_id
    const node = rootId ? this.graph.nodes.get(rootId) : undefined
    if (!rootId || !node) {
      return {
        nodeId: '',
        caller: emptyState(this.index),
        path: [],
        failedAttempts: 0,
        finished: true,
        fightRound: null,
        fightSilences: 0,
      }
    }
    // The entrance forks on arrival too. Nothing has been granted yet, so this
    // is almost always a no-op — but "almost always" is not "never", and a
    // story whose first room checks a flag would otherwise start in the wrong
    // place in rehearsal and the right one on the phone.
    return this.enter(
      {
        nodeId: rootId,
        caller: emptyState(this.index),
        path: [],
        failedAttempts: 0,
        finished: false,
        fightRound: null,
        fightSilences: 0,
      },
      rootId,
    ).next
  }

  /** 0 when the room is a fight with something to answer, null otherwise. */
  private openingRound(nodeId: string): number | null {
    const view = buildFightView(this.graph, nodeId)
    return view && view.rounds.length > 0 ? 0 : null
  }

  private nodeEffects(nodeId: string): EffectLike[] {
    return this.effectsWhere((e) => e.node_id === nodeId)
  }

  private choiceEffects(choiceId: string): EffectLike[] {
    return this.effectsWhere((e) => e.choice_id === choiceId)
  }

  private effectsWhere(predicate: (e: { node_id: string | null; choice_id: string | null }) => boolean) {
    return [...this.graph.effects.values()]
      .filter(predicate)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map<EffectLike>((e) => ({
        varSlug: this.graph.stateVars.get(e.state_var_id)?.slug ?? '',
        operation: e.operation,
        amount: e.amount,
      }))
      .filter((e) => e.varSlug)
  }

  /** The fight in the room the caller is standing in, if there is one. */
  fightAt(state: PlaytestState): FightView | null {
    return buildFightView(this.graph, state.nodeId)
  }

  /** What this room reads out. */
  playback(_state: PlaytestState, nodeId = _state.nodeId): PlaybackPart[] {
    return playbackFor(this.graph, nodeId)
  }

  /** What the opponent just did — read after the room's own narration. */
  roundPrompt(state: PlaytestState): string | null {
    const view = this.fightAt(state)
    if (!view || state.fightRound === null) return null
    const round = view.rounds[state.fightRound]
    if (!round) return null
    return round.narration || `${view.fight.opponent_name}: ${round.opponent_move}`
  }

  /** The moves on offer this round, in keypad order. */
  fightOptions(state: PlaytestState): FightOption[] {
    const view = this.fightAt(state)
    if (!view || state.fightRound === null) return []
    return view.moves
      .slice(0, 9)
      .map((m, i) => ({ digit: String(i + 1), slug: m.slug, label: m.label || m.slug }))
  }

  /**
   * What the caller is offered here, in digit order.
   *
   * A fight room offers nothing: whatever doors it happens to have, the fight
   * decides where the caller goes, and listing them would let the playtest walk
   * a route the phone never allows.
   */
  offered(state: PlaytestState): OfferedChoice[] {
    if (state.fightRound !== null) return []
    const out: OfferedChoice[] = []
    for (const choice of this.graph.choices.values()) {
      if (choice.from_node_id !== state.nodeId) continue
      const gate = [...this.graph.gates.values()].find((g) => g.choice_id === choice.id)
      const open = gate ? evaluate(gate.expression, state.caller, this.index) : true

      // A failed `hide` gate isn't read aloud at all — the door isn't there.
      if (gate && !open && gate.fail_behavior === 'hide') continue

      out.push({
        choice,
        open,
        label: choice.label,
        gate: gate
          ? {
              failBehavior: gate.fail_behavior,
              failNarration: gate.fail_narration,
              failNodeId: gate.fail_node_id,
              consumeOnPass: gate.consume_on_pass,
            }
          : null,
      })
    }
    return out.sort((a, b) => a.choice.sort_order - b.choice.sort_order)
  }

  /**
   * Press a digit. Returns the next state plus anything the caller hears on the
   * way — a refusal has narration of its own before they land back here.
   */
  press(state: PlaytestState, digit: string): Turn {
    // The reserved key, before anything else — except mid-fight, where the
    // exported flow doesn't offer it either. A round's keypad belongs to the
    // round, and there is no way back into the middle of one.
    if (
      state.fightRound === null &&
      this.graph.story.inventory_key &&
      digit === this.graph.story.inventory_key &&
      !this.offered(state).some((o) => o.choice.digit === digit)
    ) {
      // The phone puts them back into the room's REPLAY afterwards, so the
      // rehearsal does too — otherwise checking your pockets leaves you
      // looking at a keypad with nothing having been said.
      return {
        next: state,
        heard: [said(`${state.nodeId}:readback`, this.readback(state)), ...this.arrival(state)],
      }
    }

    if (state.fightRound !== null) return this.pressInFight(state, digit)

    const offer = this.offered(state).find((o) => o.choice.digit === digit)

    if (!offer) {
      // F5.4's sibling: a wrong keypress goes to invalid_target_id, or repeats.
      const node = this.graph.nodes.get(state.nodeId)
      const target = node?.invalid_target_id
      if (target && this.graph.nodes.has(target)) return this.enter(state, target)
      // Repeated, not merely refused: the exported gather replays the room on
      // a wrong key, and a rehearsal that only tutted would hide how long the
      // caller actually waits.
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        heard: [
          said(`${state.nodeId}:wrong`, "That isn't one of the options."),
          ...this.arrival(state),
        ],
      }
    }

    if (!offer.open && offer.gate) {
      if (offer.gate.failBehavior === 'divert' && offer.gate.failNodeId) {
        // A divert is a FORK, not a refusal: the caller pressed the key and
        // went somewhere, so the reaction to pressing it plays on this route
        // too. The exporter wraps the split the same way, and the two must not
        // disagree about what is heard.
        return this.withReaction(offer.choice.id, this.enter(state, offer.gate.failNodeId))
      }
      // `refuse` — say why, and stay put. The refusal has a take of its own,
      // and it is played here: reading it in a robot voice while a recording
      // existed would rehearse a scene nobody is going to hear.
      const gate = [...this.graph.gates.values()].find((g) => g.choice_id === offer.choice.id)
      const why = offer.gate.failNarration?.trim()
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        heard: [
          {
            id: `${offer.choice.id}:refuse`,
            audioPath: gate?.fail_audio_path ?? null,
            say: why || "You can't do that yet.",
            speaker: null,
          },
        ],
      }
    }

    let caller = state.caller
    let spent: PlaybackPart[] = []

    // F8.9 — spend the consumable that opened the gate. `consumedBy` walks the
    // expression rather than flattening it, so a door the crowbar OR the key
    // opens spends only the one that opened it — flattening took both from a
    // caller carrying both.
    if (offer.gate?.consumeOnPass) {
      const gate = [...this.graph.gates.values()].find((g) => g.choice_id === offer.choice.id)
      const consumed = consumedBy(gate?.expression, caller, this.index, (slug) =>
        Boolean([...this.graph.stateVars.values()].find((x) => x.slug === slug)?.is_consumable),
      ).map<EffectLike>((slug) => ({ varSlug: slug, operation: 'revoke', amount: null }))
      caller = applyEffects(caller, consumed, this.index)
      spent = spendClips(this.graph, consumed.map((c) => c.varSlug))
    }

    // What the items themselves say as they change hands — heard after the
    // effect that moves them, and before the room they move you into. Same
    // order the exporter emits, which is the only reason the two can be
    // trusted to agree.
    const fx = this.choiceEffects(offer.choice.id)
    const gained = clipsFor(this.graph, fx)
    caller = applyEffects(caller, fx, this.index)

    if (!offer.choice.to_node_id) {
      return {
        next: { ...state, caller, failedAttempts: 0 },
        heard: [
          ...spent,
          ...gained,
          said(`${offer.choice.id}:unwritten`, '(This branch is unwritten — nothing happens.)'),
        ],
      }
    }
    const arrival = this.enter({ ...state, caller }, offer.choice.to_node_id)
    return this.withReaction(offer.choice.id, {
      ...arrival,
      heard: [...spent, ...gained, ...arrival.heard],
    })
  }

  /**
   * The reaction, between the press and the arrival, in that order.
   *
   * Split by speaker if it has been, and attributed the same way a room's lines
   * are — a two-hander in a doorway reads as nonsense without the names.
   * Written but unrecorded is flagged rather than read out as though it will
   * ship: on the phone that part is silence.
   */
  private withReaction(choiceId: string, arrival: Turn): Turn {
    const reaction = reactionPlaybackFor(this.graph, choiceId).filter(
      (part) => part.say.trim() || part.audioPath,
    )
    if (reaction.length === 0) return arrival
    return { ...arrival, heard: [...reaction, ...arrival.heard] }
  }

  /**
   * A digit pressed mid-fight.
   *
   * Where it goes is `resolveMove`'s decision, not this method's — the exporter
   * asks the same function, which is the only reason a fight can be trusted to
   * behave on the phone the way it behaves here. A digit no move is mapped to
   * takes the miss route rather than being rejected: pressing 9 in a fight is an
   * answer, and a fight you can retry until you guess right is not a fight.
   */
  private pressInFight(state: PlaytestState, digit: string): Turn {
    const view = this.fightAt(state)
    if (!view || state.fightRound === null) return { next: state, heard: [] }
    if (!view.rounds[state.fightRound]) return this.leaveFight(state, view, resolveMiss(view))

    const index = Number(digit) - 1
    const move = index >= 0 && index < MAX_FIGHT_MOVES ? view.moves[index] : undefined
    if (!move) return this.leaveFight(state, view, resolveMiss(view), 'miss')

    const outcome = resolveMove(view, state.fightRound, move.id)
    if (outcome.via === 'advance' && outcome.nextRound !== null) {
      const upcoming = view.rounds[outcome.nextRound]
      return {
        next: { ...state, fightRound: outcome.nextRound, failedAttempts: 0, fightSilences: 0 },
        heard: [
          {
            id: upcoming.id,
            audioPath: upcoming.audio_path,
            say: upcoming.narration || `${view.fight.opponent_name}: ${upcoming.opponent_move}`,
            speaker: null,
          },
        ],
      }
    }
    // `advance` is handled above, so anything reaching here leaves the fight.
    return this.leaveFight(
      state,
      view,
      outcome.nodeId,
      outcome.via === 'advance' ? 'lose' : outcome.via,
    )
  }

  /** Walk out of a fight to wherever the round said. */
  private leaveFight(
    state: PlaytestState,
    view: FightView,
    target: string | null,
    via: 'named' | 'win' | 'lose' | 'miss' = 'lose',
  ): Turn {
    const opponent = view.fight.opponent_name
    // Only the two fallback routes get a line of their own — a named
    // destination is an ordinary room and speaks for itself.
    const call =
      via === 'win' ? `${opponent} goes down.` : via === 'named' ? null : `${opponent} puts you down.`
    const lead = call ? [said(`${view.fight.id}:${via}`, call)] : []

    if (!target || !this.graph.nodes.has(target)) {
      return {
        next: {
          ...state,
          fightRound: null,
          fightSilences: 0,
          failedAttempts: state.failedAttempts + 1,
        },
        heard: [
          said(
            `${view.fight.id}:${via}:unwritten`,
            `${call ?? 'That answer.'} (Nowhere is set for this answer — the branch is unwritten.)`,
          ),
        ],
      }
    }
    const arrival = this.enter(state, target)
    return { ...arrival, heard: [...lead, ...arrival.heard] }
  }

  /** F5.4 — the caller said nothing in time. */
  timeout(state: PlaytestState): Turn {
    // Silence in a fight repeats the round a few times before the fight is
    // called. Callers hesitate and mishear, and a round that killed you on the
    // first pause would be unplayable — but a round that repeated forever could
    // be waited out, so the patience is finite. The exporter counts the same
    // way, with a flow variable and a split, and the two must not disagree.
    if (state.fightRound !== null) {
      const view = this.fightAt(state)
      if (view) {
        const silences = state.fightSilences + 1
        if (silences < view.fight.silence_patience) {
          const again = this.roundPrompt(state)
          return {
            next: { ...state, fightSilences: silences, failedAttempts: state.failedAttempts + 1 },
            heard: again ? [said(`${state.nodeId}:again`, again)] : [],
          }
        }
        return this.leaveFight(state, view, resolveMiss(view), 'miss')
      }
    }

    const node = this.graph.nodes.get(state.nodeId)
    const target = node?.timeout_target_id
    if (target && this.graph.nodes.has(target)) return this.enter(state, target)
    // Null means "repeat this node" (§4.2's default) — and repeat means read
    // it out again, which is what the gather does on the phone. It used to
    // return nothing, so a timeout in rehearsal was a silence you could not
    // tell from the app having stopped working.
    return {
      next: { ...state, failedAttempts: state.failedAttempts + 1 },
      heard: this.arrival(state),
    }
  }

  /**
   * Walking into a room: its arrival effects fire, then it reads itself out.
   *
   * The reading is RETURNED rather than left for the screen to notice, which
   * is what makes a door back into the room you are already standing in behave
   * — the screen used to watch which room was current and replay on a change,
   * so a self-loop played nothing at all while the phone read the room again.
   */
  private enter(state: PlaytestState, nodeId: string): Turn {
    const here = this.graph.nodes.get(nodeId)
    if (!here) return { next: state, heard: [] }

    const onArrival = this.nodeEffects(nodeId)
    const next: PlaytestState = {
      nodeId,
      caller: applyEffects(state.caller, onArrival, this.index),
      path: [...state.path, here.slug],
      failedAttempts: 0,
      finished: here.node_type === 'ending',
      fightRound: this.openingRound(nodeId),
      fightSilences: 0,
    }
    // The item speaks before the room does, the way the exporter chains it:
    // picking something up on the way in is part of arriving, not a footnote
    // to the scene.
    return { next, heard: [...clipsFor(this.graph, onArrival), ...this.arrival(next)] }
  }

  /**
   * What a room says on being walked into: its script, then — if it is a
   * fight — the first round. Also what `start()` hands the screen, so the
   * first room and every room after it are read out by the same code.
   */
  arrival(state: PlaytestState): PlaybackPart[] {
    const here = this.graph.nodes.get(state.nodeId)
    const parts = here ? this.playback(state, state.nodeId) : []
    const written = parts.filter((p) => p.say.trim() || p.audioPath)
    const out =
      written.length > 0
        ? written
        : [said(`${state.nodeId}:empty`, `(${here?.slug ?? 'this room'} has no script yet)`)]
    const round = this.roundPrompt(state)
    return round ? [...out, said(`${state.nodeId}:round`, round)] : out
  }

  /** Slugs the caller is currently holding, for the live inventory row (F5.3). */
  /**
   * What the caller would actually HEAR on pressing the reserved key.
   *
   * Not the same list as `held`: the phone can only say what somebody
   * recorded, so an item with no take is silence there. Saying so here is the
   * point — it is cheaper to notice in the playtest than on the phone.
   */
  readback(state: PlaytestState): string {
    const items = [...this.graph.stateVars.values()].filter((v) => v.kind === 'item')
    const carried = items.filter((v) => {
      const bit = this.index.bit.get(v.slug)
      return bit !== undefined && (state.caller.mask & (1 << bit)) !== 0
    })
    if (carried.length === 0) {
      return this.graph.story.inventory_empty_audio_path
        ? 'You are carrying nothing.'
        : '(Carrying nothing — and there is no recording for that, so the phone says nothing at all.)'
    }
    const spoken = carried.map((v) =>
      v.audio_path
        ? v.name || v.slug
        : `${v.name || v.slug} (no recording — silence on the phone)`,
    )
    const lead = this.graph.story.inventory_intro_audio_path
      ? 'You are carrying:'
      : '(No lead-in recorded.)'
    return `${lead} ${spoken.join(', ')}.`
  }

  held(state: PlaytestState): string[] {
    const out: string[] = []
    for (const v of this.graph.stateVars.values()) {
      if (v.kind === 'counter') {
        const slot = this.index.counter.get(v.slug)
        const n = slot !== undefined ? (state.caller.counters[slot] ?? 0) : 0
        if (n > 0) out.push(`${v.name?.trim() || v.slug} ×${n}`)
      } else {
        const bit = this.index.bit.get(v.slug)
        if (bit !== undefined && (state.caller.mask & (1 << bit)) !== 0)
          out.push(v.name?.trim() || v.slug)
      }
    }
    return out
  }
}
