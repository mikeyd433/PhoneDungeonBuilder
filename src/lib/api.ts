import { supabase } from './supabase'
import type {
  Character,
  Choice,
  DialogueLine,
  Effect,
  Fight,
  FightMove,
  FightRound,
  FightRoundOutcome,
  Gate,
  Membership,
  MembershipRole,
  StateVar,
  Story,
  StoryGraph,
  StoryNode,
} from '@/types/domain'

/** Load an entire story into memory in one round trip per table. Spec §1 treats
 *  the graph as a single in-memory object, so this is the only read path. */
export async function loadStoryGraph(storyId: string): Promise<StoryGraph> {
  const byStory = (table: string) => supabase.from(table).select('*').eq('story_id', storyId)

  const [
    story,
    nodes,
    choices,
    stateVars,
    effects,
    gates,
    characters,
    dialogue,
    fights,
    fightMoves,
    fightRounds,
    fightOutcomes,
  ] = await Promise.all([
    supabase.from('stories').select('*').eq('id', storyId).single(),
    byStory('nodes'),
    byStory('choices'),
    byStory('state_vars'),
    byStory('effects'),
    byStory('gates'),
    byStory('characters'),
    byStory('dialogue_lines'),
    byStory('fights'),
    byStory('fight_moves'),
    byStory('fight_rounds'),
    byStory('fight_round_outcomes'),
  ])

  const firstError = [
    story,
    nodes,
    choices,
    stateVars,
    effects,
    gates,
    characters,
    dialogue,
    fights,
    fightMoves,
    fightRounds,
    fightOutcomes,
  ].find((r) => r.error)?.error
  if (firstError) throw firstError

  const index = <T extends { id: string }>(rows: unknown) =>
    new Map(((rows ?? []) as T[]).map((r) => [r.id, r]))

  return {
    story: story.data as Story,
    nodes: index<StoryNode>(nodes.data),
    choices: index<Choice>(choices.data),
    stateVars: index<StateVar>(stateVars.data),
    effects: index<Effect>(effects.data),
    gates: index<Gate>(gates.data),
    characters: index<Character>(characters.data),
    dialogue: index<DialogueLine>(dialogue.data),
    fights: index<Fight>(fights.data),
    fightMoves: index<FightMove>(fightMoves.data),
    fightRounds: index<FightRound>(fightRounds.data),
    fightOutcomes: index<FightRoundOutcome>(fightOutcomes.data),
  }
}

export async function listStories(): Promise<Story[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Story[]
}

export async function myRole(storyId: string): Promise<MembershipRole | null> {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return null
  const { data, error } = await supabase
    .from('memberships')
    .select('role')
    .eq('story_id', storyId)
    .eq('user_id', user.user.id)
    .maybeSingle()
  if (error) throw error
  return (data?.role as MembershipRole) ?? null
}

export async function listMembers(storyId: string): Promise<Membership[]> {
  const { data, error } = await supabase.from('memberships').select('*').eq('story_id', storyId)
  if (error) throw error
  return (data ?? []) as Membership[]
}

// ------------------------------------------------------------ writes

/**
 * Create a story.
 *
 * `seedEntrance` is on by default because root_node_id is what BFS depth and the
 * automap layout hang off — a story with no root has no derivable structure at
 * all. The importer passes false, since the sheet brings its own entrance and a
 * placeholder would only have to be deleted again.
 */
export async function createStory(title: string, seedEntrance = true): Promise<Story> {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('not signed in')

  const { data: story, error } = await supabase
    .from('stories')
    .insert({ title, owner_id: user.user.id })
    .select()
    .single()
  if (error) throw error

  if (!seedEntrance) return story as Story

  const entrance = await createNode(story.id, {
    slug: 'ENTRANCE',
    title: 'The entrance',
  })
  const { data: updated, error: rootError } = await supabase
    .from('stories')
    .update({ root_node_id: entrance.id })
    .eq('id', story.id)
    .select()
    .single()
  if (rootError) throw rootError

  return updated as Story
}

export async function updateStory(id: string, patch: Partial<Story>): Promise<Story> {
  const { data, error } = await supabase.from('stories').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as Story
}

export async function createNode(
  storyId: string,
  patch: Partial<StoryNode> & { slug: string },
): Promise<StoryNode> {
  const { data, error } = await supabase
    .from('nodes')
    .insert({ story_id: storyId, ...patch })
    .select()
    .single()
  if (error) throw error
  return data as StoryNode
}

export async function updateNode(id: string, patch: Partial<StoryNode>): Promise<StoryNode> {
  const { data, error } = await supabase.from('nodes').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as StoryNode
}

export async function deleteNode(id: string): Promise<void> {
  const { error } = await supabase.from('nodes').delete().eq('id', id)
  if (error) throw error
}

export async function createChoice(
  storyId: string,
  patch: Partial<Choice> & { from_node_id: string; digit: string },
): Promise<Choice> {
  const { data, error } = await supabase
    .from('choices')
    .insert({ story_id: storyId, ...patch })
    .select()
    .single()
  if (error) throw error
  return data as Choice
}

export async function updateChoice(id: string, patch: Partial<Choice>): Promise<Choice> {
  const { data, error } = await supabase.from('choices').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as Choice
}

export async function deleteChoice(id: string): Promise<void> {
  const { error } = await supabase.from('choices').delete().eq('id', id)
  if (error) throw error
}

export async function createStateVar(
  storyId: string,
  patch: Partial<StateVar> & { slug: string },
): Promise<StateVar> {
  const { data, error } = await supabase
    .from('state_vars')
    .insert({ story_id: storyId, ...patch })
    .select()
    .single()
  if (error) throw error
  return data as StateVar
}

export async function createEffect(
  storyId: string,
  patch: Omit<Partial<Effect>, 'id'> & { state_var_id: string; operation: Effect['operation'] },
): Promise<Effect> {
  const { data, error } = await supabase
    .from('effects')
    .insert({ story_id: storyId, ...patch })
    .select()
    .single()
  if (error) throw error
  return data as Effect
}

export async function deleteEffect(id: string): Promise<void> {
  const { error } = await supabase.from('effects').delete().eq('id', id)
  if (error) throw error
}

// ------------------------------------------------------------ state & gates

export async function updateStateVar(id: string, patch: Partial<StateVar>): Promise<StateVar> {
  const { data, error } = await supabase
    .from('state_vars')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as StateVar
}

export async function deleteStateVar(id: string): Promise<void> {
  const { error } = await supabase.from('state_vars').delete().eq('id', id)
  if (error) throw error
}

/** One gate per choice, so this upserts on the choice rather than the gate id. */
export async function upsertGate(
  storyId: string,
  choiceId: string,
  patch: Partial<Gate>,
): Promise<Gate> {
  const { data, error } = await supabase
    .from('gates')
    .upsert({ story_id: storyId, choice_id: choiceId, ...patch }, { onConflict: 'choice_id' })
    .select()
    .single()
  if (error) throw error
  return data as Gate
}

export async function deleteGate(choiceId: string): Promise<void> {
  const { error } = await supabase.from('gates').delete().eq('choice_id', choiceId)
  if (error) throw error
}

// ------------------------------------------------------------ cast & dialogue

/**
 * The five new tables all take story_id and hand back the inserted row, so one
 * generic pair beats ten near-identical wrappers. The story_id passed here is
 * advisory: a trigger overwrites it from the parent row, which is what stops a
 * forged id from smuggling a line into someone else's story.
 */
async function insertRow<T>(table: string, storyId: string, patch: object): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .insert({ story_id: storyId, ...patch })
    .select()
    .single()
  if (error) throw error
  return data as T
}

async function updateRow<T>(table: string, id: string, patch: object): Promise<T> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single()
  if (error) throw error
  return data as T
}

async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

export const createCharacter = (storyId: string, patch: Partial<Character> & { slug: string; name: string }) =>
  insertRow<Character>('characters', storyId, patch)
export const updateCharacter = (id: string, patch: Partial<Character>) =>
  updateRow<Character>('characters', id, patch)
export const deleteCharacter = (id: string) => deleteRow('characters', id)

export const createDialogueLine = (
  storyId: string,
  patch: Partial<DialogueLine> & { node_id: string; text: string },
) => insertRow<DialogueLine>('dialogue_lines', storyId, patch)
export const updateDialogueLine = (id: string, patch: Partial<DialogueLine>) =>
  updateRow<DialogueLine>('dialogue_lines', id, patch)
export const deleteDialogueLine = (id: string) => deleteRow('dialogue_lines', id)

/** Replace a room's lines wholesale. Splitting narration rewrites every line at
 *  once, and a delete-then-insert keeps sort_order contiguous without a second
 *  pass to renumber. */
export async function replaceDialogue(
  storyId: string,
  nodeId: string,
  lines: Array<{
    character_id: string | null
    text: string
    /* Carried through explicitly. These rows are deleted and re-inserted, so a
       line's take would be lost on every text edit if the caller didn't say
       which recording belongs to which line. */
    audio_path?: string | null
    audio_duration_ms?: number | null
  }>,
): Promise<DialogueLine[]> {
  const { error } = await supabase.from('dialogue_lines').delete().eq('node_id', nodeId)
  if (error) throw error
  if (lines.length === 0) return []
  const { data, error: insertError } = await supabase
    .from('dialogue_lines')
    .insert(
      lines.map((l, i) => ({ story_id: storyId, node_id: nodeId, sort_order: i, ...l })),
    )
    .select()
  if (insertError) throw insertError
  return (data ?? []) as DialogueLine[]
}

// ------------------------------------------------------------ fights

export const createFight = (storyId: string, patch: Partial<Fight> & { node_id: string }) =>
  insertRow<Fight>('fights', storyId, patch)
export const updateFight = (id: string, patch: Partial<Fight>) => updateRow<Fight>('fights', id, patch)
export const deleteFight = (id: string) => deleteRow('fights', id)

export const createFightMove = (
  storyId: string,
  patch: Partial<FightMove> & { fight_id: string; slug: string },
) => insertRow<FightMove>('fight_moves', storyId, patch)
export const updateFightMove = (id: string, patch: Partial<FightMove>) =>
  updateRow<FightMove>('fight_moves', id, patch)
export const deleteFightMove = (id: string) => deleteRow('fight_moves', id)

export const createFightRound = (storyId: string, patch: Partial<FightRound> & { fight_id: string }) =>
  insertRow<FightRound>('fight_rounds', storyId, patch)
export const updateFightRound = (id: string, patch: Partial<FightRound>) =>
  updateRow<FightRound>('fight_rounds', id, patch)
export const deleteFightRound = (id: string) => deleteRow('fight_rounds', id)

/**
 * Name where one move goes in one round.
 *
 * Upserted on (round, move) rather than on the row id: the editor knows which
 * cell of the grid it is filling in, and never which row — if it has one at all.
 */
export async function upsertFightOutcome(
  storyId: string,
  roundId: string,
  moveId: string,
  toNodeId: string | null,
): Promise<FightRoundOutcome> {
  const { data, error } = await supabase
    .from('fight_round_outcomes')
    .upsert(
      { story_id: storyId, round_id: roundId, move_id: moveId, to_node_id: toNodeId },
      { onConflict: 'round_id,move_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data as FightRoundOutcome
}

/** Drop the naming and fall back to the counter rule. */
export async function deleteFightOutcome(roundId: string, moveId: string): Promise<void> {
  const { error } = await supabase
    .from('fight_round_outcomes')
    .delete()
    .eq('round_id', roundId)
    .eq('move_id', moveId)
  if (error) throw error
}
