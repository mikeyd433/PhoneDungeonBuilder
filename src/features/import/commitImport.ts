import { supabase } from '@/lib/supabase'
import type { ImportPlan } from './buildImport'

export interface CommitResult {
  nodesCreated: number
  choicesCreated: number
  stateVarsCreated: number
  effectsCreated: number
}

/**
 * Write an approved plan into an existing story.
 *
 * Runs in dependency order — nodes, then state vars, then choices (which need
 * node ids), then effects (which need both). Inserts are batched per table
 * rather than per row; a 200-room sheet issuing 200 round trips would take
 * minutes on a van's signal.
 *
 * Not transactional: PostgREST has no client-side transaction, so a mid-way
 * failure leaves a partial import. The import screen therefore targets a story
 * you have just created, where the recovery is to delete it and retry rather
 * than to unpick rows.
 */
export async function commitImportPlan(storyId: string, plan: ImportPlan): Promise<CommitResult> {
  // --- nodes
  const { data: nodes, error: nodeError } = await supabase
    .from('nodes')
    .insert(
      plan.nodes.map((n) => ({
        story_id: storyId,
        slug: n.slug,
        title: n.title,
        narration: n.narration,
        node_type: n.node_type,
        notes: n.notes,
        status: n.recorded ? 'recorded' : n.narration ? 'scripted' : 'stub',
      })),
    )
    .select('id, slug')
  if (nodeError) throw nodeError

  const nodeIdBySlug = new Map((nodes ?? []).map((n) => [n.slug as string, n.id as string]))

  // --- state vars
  let stateVarRows: Array<{ id: string; slug: string }> = []
  if (plan.stateVars.length > 0) {
    const { data, error } = await supabase
      .from('state_vars')
      .insert(
        plan.stateVars.map((v) => ({
          story_id: storyId,
          slug: v.slug,
          name: v.name,
          kind: 'item' as const,
        })),
      )
      .select('id, slug')
    if (error) throw error
    stateVarRows = (data ?? []) as Array<{ id: string; slug: string }>
  }
  const varIdBySlug = new Map(stateVarRows.map((v) => [v.slug, v.id]))

  // --- choices
  let choicesCreated = 0
  if (plan.choices.length > 0) {
    const { data, error } = await supabase
      .from('choices')
      .insert(
        plan.choices.map((c) => ({
          story_id: storyId,
          from_node_id: nodeIdBySlug.get(c.fromSlug)!,
          digit: c.digit,
          label: c.label,
          to_node_id: c.toSlug ? (nodeIdBySlug.get(c.toSlug) ?? null) : null,
          sort_order: Number(c.digit) || 0,
        })),
      )
      .select('id')
    if (error) throw error
    choicesCreated = data?.length ?? 0
  }

  // --- effects (node-level on import; §8 expects an item-placement pass after)
  let effectsCreated = 0
  const effectRows = plan.effects
    .map((e) => ({
      story_id: storyId,
      node_id: nodeIdBySlug.get(e.nodeSlug),
      state_var_id: varIdBySlug.get(e.varSlug),
      operation: e.operation,
    }))
    .filter((r) => r.node_id && r.state_var_id)
  if (effectRows.length > 0) {
    const { data, error } = await supabase.from('effects').insert(effectRows).select('id')
    if (error) throw error
    effectsCreated = data?.length ?? 0
  }

  // --- entrance
  if (plan.rootSlug) {
    const rootId = nodeIdBySlug.get(plan.rootSlug)
    if (rootId) {
      const { error } = await supabase
        .from('stories')
        .update({ root_node_id: rootId })
        .eq('id', storyId)
      if (error) throw error
    }
  }

  return {
    nodesCreated: nodes?.length ?? 0,
    choicesCreated,
    stateVarsCreated: stateVarRows.length,
    effectsCreated,
  }
}
