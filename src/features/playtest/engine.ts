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
import { reactionPlaybackFor, type PlaybackPart } from '@/features/cast/dialogue'
import { playbackWithState, readingFor, walkArrival } from '@/features/room/variants'

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

  /**
   * What this room reads out to THIS caller.
   *
   * A room with alternate readings plays the first whose condition the caller
   * satisfies, and its own narration when none of them do. Asked here rather
   * than worked out by the transcript, so the playtest and the exported flow
   * are answering the same question with the same code.
   */
  playback(state: PlaytestState, nodeId = state.nodeId): PlaybackPart[] {
    return playbackWithState(this.graph, nodeId, state.caller, this.index)
  }

  /** The alternate reading in play, for the transcript's "which one is this?".
   *  Null means the room's own narration — the ordinary case. */
  readingAt(state: PlaytestState, nodeId = state.nodeId) {
    return readingFor(this.graph, nodeId, state.caller, this.index)
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
  press(state: PlaytestState, digit: string): { next: PlaytestState; spoken: string | null } {
    // The reserved key, before anything else — except mid-fight, where the
    // exported flow doesn't offer it either. A round's keypad belongs to the
    // round, and there is no way back into the middle of one.
    if (
      state.fightRound === null &&
      this.graph.story.inventory_key &&
      digit === this.graph.story.inventory_key &&
      !this.offered(state).some((o) => o.choice.digit === digit)
    ) {
      return { next: state, spoken: this.readback(state) }
    }

    if (state.fightRound !== null) return this.pressInFight(state, digit)

    const offer = this.offered(state).find((o) => o.choice.digit === digit)

    if (!offer) {
      // F5.4's sibling: a wrong keypress goes to invalid_target_id, or repeats.
      const node = this.graph.nodes.get(state.nodeId)
      const target = node?.invalid_target_id
      if (target && this.graph.nodes.has(target)) return this.enter(state, target)
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        spoken: "That isn't one of the options.",
      }
    }

    if (!offer.open && offer.gate) {
      if (offer.gate.failBehavior === 'divert' && offer.gate.failNodeId) {
        return this.enter(state, offer.gate.failNodeId)
      }
      // `refuse` — say why, and stay put.
      return {
        next: { ...state, failedAttempts: state.failedAttempts + 1 },
        spoken: offer.gate.failNarration ?? "You can't do that yet.",
      }
    }

    let caller = state.caller

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
    }

    caller = applyEffects(caller, this.choiceEffects(offer.choice.id), this.index)

    if (!offer.choice.to_node_id) {
      return {
        next: { ...state, caller, failedAttempts: 0 },
        spoken: '(This branch is unwritten — nothing happens.)',
      }
    }
    const arrival = this.enter({ ...state, caller }, offer.choice.to_node_id)

    // The reaction, between the press and the arrival, in that order. Split by
    // speaker if it has been, and attributed the same way a room's lines are —
    // a two-hander in a doorway reads as nonsense without the names.
    //
    // Written but unrecorded is flagged rather than read out as though it will
    // ship: on the phone that part is silence.
    const reaction = reactionPlaybackFor(this.graph, offer.choice.id)
      .map((part) => {
        const said = part.say.trim()
        if (!said) return ''
        const who = part.speaker ? `${part.speaker}: ` : ''
        return `${who}${said}${part.audioPath ? '' : ' (no recording — silence on the phone)'}`
      })
      .filter(Boolean)
      .join('\n')
    if (!reaction) return arrival
    return { ...arrival, spoken: [reaction, arrival.spoken].filter(Boolean).join('\n\n') }
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
  private pressInFight(
    state: PlaytestState,
    digit: string,
  ): { next: PlaytestState; spoken: string | null } {
    const view = this.fightAt(state)
    if (!view || state.fightRound === null) return { next: state, spoken: null }
    if (!view.rounds[state.fightRound]) return this.leaveFight(state, view, resolveMiss(view))

    const index = Number(digit) - 1
    const move = index >= 0 && index < MAX_FIGHT_MOVES ? view.moves[index] : undefined
    if (!move) return this.leaveFight(state, view, resolveMiss(view), 'miss')

    const outcome = resolveMove(view, state.fightRound, move.id)
    if (outcome.via === 'advance' && outcome.nextRound !== null) {
      const upcoming = view.rounds[outcome.nextRound]
      return {
        next: { ...state, fightRound: outcome.nextRound, failedAttempts: 0, fightSilences: 0 },
        spoken: upcoming.narration || `${view.fight.opponent_name}: ${upcoming.opponent_move}`,
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
  ): { next: PlaytestState; spoken: string | null } {
    const opponent = view.fight.opponent_name
    // Only the two fallback routes get a line of their own — a named
    // destination is an ordinary room and speaks for itself.
    const spoken =
      via === 'win' ? `${opponent} goes down.` : via === 'named' ? null : `${opponent} puts you down.`

    if (!target || !this.graph.nodes.has(target)) {
      return {
        next: {
          ...state,
          fightRound: null,
          fightSilences: 0,
          failedAttempts: state.failedAttempts + 1,
        },
        spoken: `${spoken ?? 'That answer'} (Nowhere is set for this answer — the branch is unwritten.)`,
      }
    }
    return { next: this.enter(state, target).next, spoken }
  }

  /** F5.4 — the caller said nothing in time. */
  timeout(state: PlaytestState): { next: PlaytestState; spoken: string | null } {
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
          return {
            next: { ...state, fightSilences: silences, failedAttempts: state.failedAttempts + 1 },
            spoken: this.roundPrompt(state),
          }
        }
        return this.leaveFight(state, view, resolveMiss(view), 'miss')
      }
    }

    const node = this.graph.nodes.get(state.nodeId)
    const target = node?.timeout_target_id
    if (target && this.graph.nodes.has(target)) return this.enter(state, target)
    // Null means "repeat this node" (§4.2's default).
    return { next: { ...state, failedAttempts: state.failedAttempts + 1 }, spoken: null }
  }

  /**
   * Walking into a room, and through any arrival check that sends them on.
   *
   * A check is not a choice: the caller does not press anything and cannot
   * refuse it, so the whole chain resolves before they are standing anywhere.
   * `walkArrival` is what the exported flow's `_read` -> `_alt` -> next room
   * chain does, asked in TypeScript — and every room passed through goes on the
   * path, because "which rooms did this call touch" is what the path log is for
   * and a room they were routed through is one of them.
   */
  private enter(state: PlaytestState, nodeId: string): { next: PlaytestState; spoken: string | null } {
    const node = this.graph.nodes.get(nodeId)
    if (!node) return { next: state, spoken: null }

    const walk = walkArrival(this.graph, nodeId, state.caller, this.index, (id, at) =>
      applyEffects(at, this.nodeEffects(id), this.index),
    )
    const landed = walk.steps[walk.steps.length - 1]
    const here = this.graph.nodes.get(landed.nodeId)!

    // Anything heard on the way through. The room they end up in reads itself
    // out separately, the way it always has, so only the rooms PASSED THROUGH
    // speak here — otherwise the arrival would be read out twice.
    const passed = walk.steps
      .slice(0, -1)
      .map((step) => step.variant?.narration.trim())
      .filter((text): text is string => Boolean(text))
    if (walk.looped) {
      passed.push(
        '(These arrival checks send the caller round in a circle — on the phone this is a call that never lands.)',
      )
    }

    return {
      next: {
        nodeId: landed.nodeId,
        caller: walk.caller,
        path: [...state.path, ...walk.steps.map((s) => this.graph.nodes.get(s.nodeId)!.slug)],
        failedAttempts: 0,
        finished: here.node_type === 'ending',
        fightRound: this.openingRound(landed.nodeId),
        fightSilences: 0,
      },
      spoken: passed.length > 0 ? passed.join('\n') : null,
    }
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
