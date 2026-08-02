import { supabase } from './supabase'
import type {
  Choice,
  Effect,
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
  const [story, nodes, choices, stateVars, effects, gates] = await Promise.all([
    supabase.from('stories').select('*').eq('id', storyId).single(),
    supabase.from('nodes').select('*').eq('story_id', storyId),
    supabase.from('choices').select('*').eq('story_id', storyId),
    supabase.from('state_vars').select('*').eq('story_id', storyId),
    supabase.from('effects').select('*').eq('story_id', storyId),
    supabase.from('gates').select('*').eq('story_id', storyId),
  ])

  const firstError =
    story.error ?? nodes.error ?? choices.error ?? stateVars.error ?? effects.error ?? gates.error
  if (firstError) throw firstError

  const index = <T extends { id: string }>(rows: T[] | null) =>
    new Map((rows ?? []).map((r) => [r.id, r]))

  return {
    story: story.data as Story,
    nodes: index<StoryNode>(nodes.data as StoryNode[]),
    choices: index<Choice>(choices.data as Choice[]),
    stateVars: index<StateVar>(stateVars.data as StateVar[]),
    effects: index<Effect>(effects.data as Effect[]),
    gates: index<Gate>(gates.data as Gate[]),
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
