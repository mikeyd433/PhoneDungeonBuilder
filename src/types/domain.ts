// Domain types. These mirror supabase/migrations/0001_initial_schema.sql —
// keep the two in step, and when they disagree the migration wins.

export type NodeType = 'room' | 'ending'

/** An ending is read out and then hung up on either way; which of the two it
 *  is, is the author's bookkeeping and what the room and the map draw. */
export type EndingKind = 'death' | 'win'
export type NodeStatus = 'stub' | 'scripted' | 'recorded' | 'approved'
export type StateVarKind = 'item' | 'flag' | 'counter'
export type EffectOperation = 'grant' | 'revoke' | 'set' | 'add'
export type GateFailBehavior = 'hide' | 'refuse' | 'divert'
export type MembershipRole = 'owner' | 'writer' | 'voice' | 'viewer'

/** Valid keypad digits, in the order a phone keypad reads. */
export const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as const
export type Digit = (typeof DIGITS)[number]

/** Spec §11.1: three exits fits the walls and good IVR practice. Beyond this,
 *  F1.13 renders a stacked list rather than walls. */
export const WALL_EXITS = 3

export interface Story {
  id: string
  title: string
  root_node_id: string | null
  owner_id: string
  counter_clamp: number
  default_fail_behavior: GateFailBehavior
  /**
   * The key a caller presses in any room to hear what they are carrying.
   *
   * Null means the story has no readback, which is the default — a story that
   * never grants anything should not spend a key on it. Only `*` or `#`: every
   * other key is a door somewhere.
   */
  inventory_key: InventoryKey | null
  inventory_intro_audio_path: string | null
  inventory_intro_audio_duration_ms: number | null
  inventory_empty_audio_path: string | null
  inventory_empty_audio_duration_ms: number | null
  created_at: string
  updated_at: string
}

/** The only two keys that are never a door. */
export const INVENTORY_KEYS = ['*', '#'] as const
export type InventoryKey = (typeof INVENTORY_KEYS)[number]

export interface StoryNode {
  id: string
  story_id: string
  slug: string
  title: string
  narration: string
  node_type: NodeType
  /** Only meaningful on an ending. Null reads as a death, which is what every
   *  ending was before this existed. */
  ending_kind: EndingKind | null
  audio_path: string | null
  audio_duration_ms: number | null
  status: NodeStatus
  notes: string | null
  timeout_target_id: string | null
  invalid_target_id: string | null
  timeout_seconds: number
  /** Visual treatment for the room view; falls back to `stone` if unknown. */
  room_design: string
  created_at: string
  updated_at: string
}

export interface Choice {
  id: string
  story_id: string
  from_node_id: string
  digit: Digit
  label: string
  /** null = bricked archway, an unwritten branch. */
  to_node_id: string | null
  /**
   * The reaction to having made this choice: what is said between the keypress
   * and the next room. It belongs to neither room either side of it — put it in
   * the one you left and every other door hears it too; put it in the one you
   * arrive at and it plays again when you come back by another route.
   *
   * Script and take, as everywhere else. Unrecorded is silence.
   */
  reaction_narration: string | null
  audio_path: string | null
  audio_duration_ms: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface StateVar {
  id: string
  story_id: string
  slug: string
  name: string
  kind: StateVarKind
  description: string | null
  is_consumable: boolean
  /** A take of the item's name, for the readback. Unrecorded is silence. */
  audio_path: string | null
  audio_duration_ms: number | null
  created_at: string
  updated_at: string
}

export interface Effect {
  id: string
  story_id: string
  /** Exactly one of node_id / choice_id is set. A node effect fires on arrival;
   *  a choice effect fires when that digit is pressed. */
  node_id: string | null
  choice_id: string | null
  state_var_id: string
  operation: EffectOperation
  amount: number | null
  sort_order: number
  created_at: string
}

// ------------------------------------------------------------ gate expressions

/** The boolean tree stored in gates.expression. Built by the UI, never typed by
 *  hand (§2). Compiles to Liquid for the Twilio export (§6.3). */
export type GateExpression =
  | { op: 'has'; var: string }
  | { op: 'lacks'; var: string }
  | { op: 'gte'; var: string; value: number }
  | { op: 'lte'; var: string; value: number }
  | { op: 'eq'; var: string; value: number }
  | { op: 'and'; args: GateExpression[] }
  | { op: 'or'; args: GateExpression[] }
  | { op: 'not'; args: [GateExpression] }

export interface Gate {
  id: string
  story_id: string
  choice_id: string
  expression: GateExpression
  fail_behavior: GateFailBehavior
  fail_narration: string | null
  /** A refusal is read aloud like anything else, so it gets its own take.
   *  Without one the exported flow simply doesn't say it — the caller is
   *  bounced back to the choices with no explanation. */
  fail_audio_path: string | null
  fail_audio_duration_ms: number | null
  fail_node_id: string | null
  consume_on_pass: boolean
  created_at: string
  updated_at: string
}

/**
 * An alternate reading of a room, chosen by what the caller is carrying.
 *
 * Tried in `sort_order`; the FIRST whose expression passes is what plays. None
 * passing means the room's own narration plays, so the room itself is the
 * "otherwise" rather than a fourth variant — which is what makes adding this to
 * a story change nothing about a room that has none.
 *
 * One take, not a line split: a variant is an alternate reading, recorded the
 * way an alternate reading is. And no effects — which reading plays depends on
 * state, and if it could also change state the room would grant different
 * things on different visits.
 */
export interface NodeVariant {
  id: string
  story_id: string
  node_id: string
  /** The same boolean tree a gate carries, built by the same builder. */
  expression: GateExpression
  narration: string
  audio_path: string | null
  audio_duration_ms: number | null
  /**
   * Where a caller this reading applies to ends up.
   *
   * Null means they stay put and are offered this room's doors — the ordinary
   * case, and what 0016 shipped. Set, and the check becomes an arrival fork:
   * hear this reading (if it has words), then walk on into that room.
   *
   * This is where two outcomes with DIFFERENT DIALOGUE diverge. A reading is
   * one take and cannot split between two actors; the room it points at is an
   * ordinary room with its own cast, its own split script and its own exits.
   */
  goto_node_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Membership {
  story_id: string
  user_id: string
  role: MembershipRole
  created_at: string
}

// ------------------------------------------------------------ cast & dialogue

/**
 * Somebody who speaks. Cast entries group lines by who says them and by who
 * records them. They have no effect on the compiled flow's SHAPE — no extra
 * gathers, no branching — but a line with its own recording does become its own
 * Play widget, so a conversation voiced by two people costs a widget per line
 * rather than one for the room.
 */
/**
 * A silhouette to stand in the room when this character speaks there.
 *
 * Opt-in per character, because "who speaks" and "who is present" are different
 * questions: the party is the caller, and the narrator is nobody, so drawing a
 * figure for every voice would put three people in a room you are alone in.
 */
export const FIGURES = ['standing', 'looming', 'small', 'seated', 'beast'] as const
export type FigureKind = (typeof FIGURES)[number]

export interface Character {
  id: string
  story_id: string
  slug: string
  name: string
  /** A character the caller can *be* — the Mike/Carter choice at the entrance. */
  is_playable: boolean
  voice_actor: string | null
  color: string
  /** Null draws nobody, which is right for the party and for the narrator. */
  figure: FigureKind | null
  notes: string | null
  created_at: string
  updated_at: string
}

/**
 * One attributed line, of a room's narration or of a door's reaction.
 *
 * Exactly one of `node_id` / `choice_id` is set — the same two-nullable-keys
 * shape as `effects`, and for the same reason: real foreign keys, real cascade
 * deletes, rather than a polymorphic owner the database cannot check.
 *
 * `character_id` null = narration with nobody speaking it.
 */
export interface DialogueLine {
  id: string
  story_id: string
  node_id: string | null
  choice_id: string | null
  character_id: string | null
  text: string
  sort_order: number
  /** A line may carry its own recording, so a conversation between two
   *  separately-booked actors can be assembled from their two sessions. Null
   *  means this line has no take of its own and the room's file covers it. */
  audio_path: string | null
  audio_duration_ms: number | null
  created_at: string
  updated_at: string
}

// ------------------------------------------------------------ fights

/**
 * A scripted exchange, hung off a room rather than replacing it.
 *
 * The room's own narration is the lead-in; then the opponent announces a move
 * each round and the caller presses a digit. Where that digit goes is the
 * round's business: a fight is functionally a room where you pick an exit, and
 * a round's moves may lead three different places, or all lead to the same one.
 *
 * `win_node_id` and `lose_node_id` are the DEFAULTS a move falls back to when
 * the round doesn't name a destination for it — the terse "one right answer"
 * fight, which is the shape the shark fight was hand-built in.
 */
export interface Fight {
  id: string
  story_id: string
  node_id: string
  opponent_name: string
  win_node_id: string | null
  lose_node_id: string | null
  /** How many times a round repeats on silence before the fight is called.
   *  Capped at 8 by the database: Studio ends an execution when one widget
   *  runs ten times in a row, so more patience than that is a hangup. */
  silence_patience: number
  created_at: string
  updated_at: string
}

/**
 * A move the caller can answer with, and the opponent move it defeats.
 *
 * More than one move may beat the same announcement. That is not a mistake —
 * it is how "any of these gets you through" is said without naming a
 * destination for every cell of the round.
 */
export interface FightMove {
  id: string
  story_id: string
  fight_id: string
  slug: string
  label: string
  /** Matched against `FightRound.opponent_move`. Null while undecided. */
  beats: string | null
  sort_order: number
  created_at: string
}

/**
 * Where one move goes in one round.
 *
 * Absent, the counter rule decides. Present with a null `to_node_id`, the
 * branch is written but unwired — a bricked archway, reported by the validator
 * exactly as an unwritten choice is.
 */
export interface FightRoundOutcome {
  id: string
  story_id: string
  fight_id: string
  round_id: string
  move_id: string
  to_node_id: string | null
  created_at: string
  updated_at: string
}

export interface FightRound {
  id: string
  story_id: string
  fight_id: string
  sort_order: number
  opponent_move: string
  narration: string
  /** A round is a performance. Nothing in the exported flow is spoken by
   *  Twilio, so a round with no take is not read out at all. */
  audio_path: string | null
  audio_duration_ms: number | null
  created_at: string
  updated_at: string
}

// ------------------------------------------------------------ derived, never stored

/**
 * Every way a caller can get from one room to another.
 *
 * A choice is the usual one, but a fight's two outcomes are edges too: the room
 * after a won fight is genuinely reachable, and treating it as anything else
 * would have the ledger call it an orphan and the automap draw it floating.
 * Structure is computed over these; the room's *exits* are still choices only,
 * because a fight is answered with moves rather than doors.
 */
export type EdgeKind = 'choice' | 'fight-win' | 'fight-lose' | 'fight-move' | 'reading'

export interface GraphEdge {
  /** Real choice id, or `fight:<fightId>:win` / `:lose` for a fight outcome. */
  id: string
  kind: EdgeKind
  from_node_id: string
  to_node_id: string | null
  digit: Digit | null
  label: string
  sort_order: number
  /** The underlying row, when this edge is a real choice. */
  choice: Choice | null
}

/** Spec §2 "Derived, never stored". Recomputed from the graph, never persisted. */
export interface DerivedGraph {
  /** BFS depth from root. Missing = unreachable. */
  depth: Map<string, number>
  /** Nodes with no inbound choices, excluding the root. */
  orphans: Set<string>
  /** Choice ids whose target is an ancestor of their source — render as a
   *  stairwell, not a door. */
  portals: Set<string>
  /** Nodes not reachable from the root by BFS (F4.8). */
  unreachable: Set<string>
  /** node id -> inbound choices, for the retreat path. */
  parents: Map<string, Choice[]>
  /** node id -> outbound choices, digit-ordered. */
  children: Map<string, Choice[]>
  /** node id -> every outbound edge, fight outcomes included. */
  edgesFrom: Map<string, GraphEdge[]>
  /** node id -> every inbound edge, fight outcomes included. */
  edgesTo: Map<string, GraphEdge[]>
}

/** Everything about one story, held in memory as a single graph (§1 Stack). */
export interface StoryGraph {
  story: Story
  nodes: Map<string, StoryNode>
  choices: Map<string, Choice>
  stateVars: Map<string, StateVar>
  effects: Map<string, Effect>
  gates: Map<string, Gate>
  variants: Map<string, NodeVariant>
  characters: Map<string, Character>
  dialogue: Map<string, DialogueLine>
  fights: Map<string, Fight>
  fightMoves: Map<string, FightMove>
  fightRounds: Map<string, FightRound>
  fightOutcomes: Map<string, FightRoundOutcome>
}

export function canWrite(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'writer'
}

export function canRecord(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'writer' || role === 'voice'
}
