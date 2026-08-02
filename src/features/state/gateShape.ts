import type { GateExpression } from '@/types/domain'

/**
 * The flat shape the gate builder edits, and its conversion to and from the
 * stored expression tree.
 *
 * Kept apart from the component so it can be unit-tested and so fast refresh
 * keeps working — and because this is domain logic, not UI.
 */
export type Leaf =
  | { op: 'has'; var: string }
  | { op: 'lacks'; var: string }
  | { op: 'gte'; var: string; value: number }
  | { op: 'lte'; var: string; value: number }
  | { op: 'eq'; var: string; value: number }

export interface FlatGate {
  root: 'and' | 'or'
  leaves: Leaf[]
}

/** Read an expression into the flat shape the editor works with. Anything more
 *  deeply nested than the editor can represent returns null, and the caller
 *  shows a read-only summary rather than silently flattening it away. */
export function toFlat(expression: GateExpression | null | undefined): FlatGate | null {
  if (!expression) return { root: 'and', leaves: [] }
  const isLeaf = (e: GateExpression): e is Leaf =>
    e.op === 'has' || e.op === 'lacks' || e.op === 'gte' || e.op === 'lte' || e.op === 'eq'

  if (isLeaf(expression)) return { root: 'and', leaves: [expression] }
  if (expression.op === 'and' || expression.op === 'or') {
    const leaves: Leaf[] = []
    for (const arg of expression.args) {
      if (isLeaf(arg)) leaves.push(arg)
      else if (arg.op === 'not' && isLeaf(arg.args[0])) {
        // `not(has X)` is exactly `lacks X`; normalise so the editor shows one
        // row rather than a negation wrapper.
        const inner = arg.args[0]
        if (inner.op === 'has') leaves.push({ op: 'lacks', var: inner.var })
        else if (inner.op === 'lacks') leaves.push({ op: 'has', var: inner.var })
        else return null
      } else return null
    }
    return { root: expression.op, leaves }
  }
  return null
}

export function fromFlat(flat: FlatGate): GateExpression {
  return { op: flat.root, args: flat.leaves as GateExpression[] }
}

