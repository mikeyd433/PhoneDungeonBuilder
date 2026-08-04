import type { StoryGraph } from '@/types/domain'
import type { EffectLike } from './expression'
import type { SolverChoice, SolverInput, SolverNode } from './solver'
import { graphEdges } from '@/features/graph/edges'

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

  // Fight outcomes come through as choices with no gate and no effects. Winning
  // a fight needs nothing in the satchel — only the right digits — so both
  // outcomes are always available, and the solver is right to treat the rooms
  // beyond them as reachable with whatever the caller walked in carrying.
  // A divert edge is deliberately NOT a choice. It is real structure — the map
  // and the reachability check need it — but the caller never presses anything
  // to take one, and modelling it as a free ungated choice would let the solver
  // walk it without the item the check asks about. The solver reaches a
  // divert's far side through the gate on the choice itself, which is where the
  // condition lives.
  const choices: SolverChoice[] = graphEdges(graph)
    .filter((e) => e.kind !== 'divert')
    .map((e) => {
    const gate = e.choice ? gateByChoice.get(e.choice.id) : undefined
    return {
      id: e.id,
      fromId: e.from_node_id,
      toId: e.to_node_id,
      digit: e.digit ?? (e.kind === 'fight-win' ? 'won' : 'lost'),
      effects: (choiceEffects.get(e.id) ?? []).map(asEffect).filter((f) => f.varSlug),
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
