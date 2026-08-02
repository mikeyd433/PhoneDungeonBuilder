import { supabase } from '@/lib/supabase'

export interface NodeComment {
  id: string
  story_id: string
  node_id: string
  author_id: string
  body: string
  resolved: boolean
  created_at: string
}

export interface Claim {
  id: string
  story_id: string
  node_id: string | null
  choice_id: string | null
  user_id: string
  note: string | null
  created_at: string
}

export async function listComments(nodeId: string): Promise<NodeComment[]> {
  const { data, error } = await supabase
    .from('node_comments')
    .select('*')
    .eq('node_id', nodeId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as NodeComment[]
}

export async function addComment(
  storyId: string,
  nodeId: string,
  body: string,
): Promise<NodeComment> {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('not signed in')
  const { data, error } = await supabase
    .from('node_comments')
    .insert({ story_id: storyId, node_id: nodeId, author_id: user.user.id, body })
    .select()
    .single()
  if (error) throw error
  return data as NodeComment
}

export async function resolveComment(id: string, resolved: boolean): Promise<void> {
  const { error } = await supabase.from('node_comments').update({ resolved }).eq('id', id)
  if (error) throw error
}

export async function listClaims(storyId: string): Promise<Claim[]> {
  const { data, error } = await supabase.from('claims').select('*').eq('story_id', storyId)
  if (error) throw error
  return (data ?? []) as Claim[]
}

/**
 * F9.4 — claim a room or an unwritten branch.
 *
 * The unique indexes mean a second claimant gets a constraint violation rather
 * than a silent overwrite. That rejection IS the feature: it is what stops two
 * people doing the same work, so it is surfaced rather than swallowed.
 */
export async function claim(
  storyId: string,
  target: { nodeId?: string; choiceId?: string },
  note?: string,
): Promise<Claim> {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('not signed in')
  const { data, error } = await supabase
    .from('claims')
    .insert({
      story_id: storyId,
      node_id: target.nodeId ?? null,
      choice_id: target.choiceId ?? null,
      user_id: user.user.id,
      note: note ?? null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Someone else already claimed this.')
    throw error
  }
  return data as Claim
}

export async function release(claimId: string): Promise<void> {
  const { error } = await supabase.from('claims').delete().eq('id', claimId)
  if (error) throw error
}
