import type { StoryGraph } from '@/types/domain'
import type { EffectLike } from './expression'
import type { SolverChoice, SolverInput, SolverNode } from './solver'
import { graphEdges } from '@/features/graph/edges'
import { doorShows, hidesDoor, variantsOf } from '@/features/room/variants'

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
    redirects: variantsOf(graph, n.id)
      .filter((v) => v.goto_node_id && v.goto_node_id !== n.id)
      .map((v) => ({ expression: v.expression, toId: v.goto_node_id! })),
    readings: variantsOf(graph, n.id).map((v) => ({ id: v.id, expression: v.expression })),
  }))

  // Fight outcomes come through as choices with no gate and no effects. Winning
  // a fight needs nothing in the satchel — only the right digits — so both
  // outcomes are always available, and the solver is right to treat the rooms
  // beyond them as reachable with whatever the caller walked in carrying.
  // Reading edges are deliberately NOT choices. They are real structure — the
  // map and the reachability check need them — but the caller never presses
  // anything to take one, and modelling one as a free ungated choice would let
  // the solver walk it without the item the check is asking about.
  const choices: SolverChoice[] = graphEdges(graph)
    .filter((e) => e.kind !== 'reading')
    .map((e) => {
    const gate = e.choice ? gateByChoice.get(e.choice.id) : undefined
    return {
      id: e.id,
      fromId: e.from_node_id,
      toId: e.to_node_id,
      digit: e.digit ?? (e.kind === 'fight-win' ? 'won' : 'lost'),
      effects: (choiceEffects.get(e.id) ?? []).map(asEffect).filter((f) => f.varSlug),
      // Only when somebody has actually hidden it somewhere: null means "every
      // reading", which is the case for all but a handful of doors and skips
      // the per-state work entirely.
      shownIn: e.choice && hidesDoor(graph, e.choice.id).length > 0
        ? [null, ...variantsOf(graph, e.from_node_id).map((v) => v.id)].filter((slot) =>
            doorShows(graph, e.choice!.id, slot),
          )
        : null,
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
