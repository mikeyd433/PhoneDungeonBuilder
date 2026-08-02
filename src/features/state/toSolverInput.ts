import type { StoryGraph } from '@/types/domain'
import type { EffectLike } from './expression'
import type { SolverChoice, SolverInput, SolverNode } from './solver'

/** Flatten the live graph into the plain, structured-cloneable shape the worker
 *  takes. Effects are resolved from state_var_id to slug here so the solver
 *  never has to carry the var table around. */
export function toSolverInput(graph: StoryGraph): SolverInput {
  const slugOf = (id: string) => graph.stateVars.get(id)?.slug ?? ''

  const asEffect = (e: {
    state_var_id: string
    operation: EffectLike['operation']
    amount: number | null
    sort_order: number
  }): EffectLike => ({
    varSlug: slugOf(e.state_var_id),
    operation: e.operation,
    amount: e.amount,
  })

  const nodeEffects = new Map<string, typeof effectsList>()
  const choiceEffects = new Map<string, typeof effectsList>()
  const effectsList = [...graph.effects.values()].sort((a, b) => a.sort_order - b.sort_order)

  for (const effect of effectsList) {
    const bucket = effect.node_id ? nodeEffects : choiceEffects
    const key = effect.node_id ?? effect.choice_id!
    if (!bucket.has(key)) bucket.set(key, [])
    bucket.get(key)!.push(effect)
  }

  const gateByChoice = new Map([...graph.gates.values()].map((g) => [g.choice_id, g]))

  const nodes: SolverNode[] = [...graph.nodes.values()].map((n) => ({
    id: n.id,
    slug: n.slug,
    isEnding: n.node_type === 'ending',
    effects: (nodeEffects.get(n.id) ?? []).map(asEffect).filter((e) => e.varSlug),
  }))

  const choices: SolverChoice[] = [...graph.choices.values()].map((c) => {
    const gate = gateByChoice.get(c.id)
    return {
      id: c.id,
      fromId: c.from_node_id,
      toId: c.to_node_id,
      digit: c.digit,
      effects: (choiceEffects.get(c.id) ?? []).map(asEffect).filter((e) => e.varSlug),
      gate: gate
        ? {
            expression: gate.expression,
            failBehavior: gate.fail_behavior,
            failNodeId: gate.fail_node_id,
            consumeOnPass: gate.consume_on_pass,
          }
        : null,
    }
  })

  return {
    rootId: graph.story.root_node_id,
    nodes,
    choices,
    vars: [...graph.stateVars.values()].map((v) => ({
      slug: v.slug,
      kind: v.kind,
      isConsumable: v.is_consumable,
    })),
    counterClamp: graph.story.counter_clamp,
  }
}
