// Domain types. These mirror supabase/migrations/0001_initial_schema.sql —
// keep the two in step, and when they disagree the migration wins.

export type NodeType = 'room' | 'ending'
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
  created_at: string
  updated_at: string
}

export interface StoryNode {
  id: string
  story_id: string
  slug: string
  title: string
  narration: string
  node_type: NodeType
  audio_path: string | null
  audio_duration_ms: number | null
  status: NodeStatus
  notes: string | null
  timeout_target_id: string | null
  invalid_target_id: string | null
  timeout_seconds: number
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
  fail_node_id: string | null
  consume_on_pass: boolean
  created_at: string
  updated_at: string
}

export interface Membership {
  story_id: string
  user_id: string
  role: MembershipRole
  created_at: string
}

// ------------------------------------------------------------ derived, never stored

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
}

/** Everything about one story, held in memory as a single graph (§1 Stack). */
export interface StoryGraph {
  story: Story
  nodes: Map<string, StoryNode>
  choices: Map<string, Choice>
  stateVars: Map<string, StateVar>
  effects: Map<string, Effect>
  gates: Map<string, Gate>
}

export function canWrite(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'writer'
}

export function canRecord(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'writer' || role === 'voice'
}
