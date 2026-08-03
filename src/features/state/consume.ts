import type { GateExpression } from '@/types/domain'
import { evaluate, type CallerState, type VarIndex } from './expression'

/**
 * Which items a passing gate actually SPENDS.
 *
 * "Use up the item that opened this" was implemented as "revoke every
 * consumable the expression mentions", which is right for a gate that requires
 * all of them and wrong the moment one requires any of them. A door the crowbar
 * OR the master key opens, taken by a caller carrying both, took both — and the
 * key they never used was gone for the door it was actually for.
 *
 * So the tree is walked rather than flattened:
 *
 *   `and` — every branch had to hold, so every branch pays.
 *   `or`  — the FIRST branch that holds is the one that opened it, and it is
 *           the only one that pays. Which is also what the checkbox says.
 *   `not` / `lacks` — nothing is spent by not having something.
 *
 * Counters are left alone: `at least 3 ROPE` is a requirement to hold three,
 * not an instruction to burn them, and there is no sensible amount to deduct.
 */
export function consumedBy(
  expression: GateExpression | null | undefined,
  caller: CallerState,
  index: VarIndex,
  isConsumable: (slug: string) => boolean,
): string[] {
  const out: string[] = []
  walk(expression, caller, index, isConsumable, out)
  // Deduped: the same item named twice in one `and` is still one item.
  return [...new Set(out)]
}

/**
 * The same decision, made without a caller — what the EXPORTER has to emit.
 *
 * Studio does not get to ask "which branch held" in TypeScript, so the shape of
 * the answer has to be baked into the flow: either every named item is spent
 * (`all`, for a gate that required all of them) or the first one the caller
 * turns out to be holding is (`first`, for a gate that took any of them).
 *
 * Only the two shapes the gate builder can produce are distinguished — a root
 * `and` or a root `or` over leaves — because `toFlat` refuses to edit anything
 * deeper, so a gate carrying a nested tree AND consume_on_pass cannot be built
 * in this app. Anything else is read as `all`, which is the conservative half:
 * it can spend an item the caller did not strictly need, never leave one behind
 * that they did.
 */
export function consumePlan(
  expression: GateExpression | null | undefined,
  isConsumable: (slug: string) => boolean,
): { mode: 'all' | 'first'; slugs: string[] } {
  const slugs: string[] = []
  collect(expression, isConsumable, slugs)
  return {
    mode: expression?.op === 'or' ? 'first' : 'all',
    slugs: [...new Set(slugs)],
  }
}

function collect(
  expression: GateExpression | null | undefined,
  isConsumable: (slug: string) => boolean,
  out: string[],
): void {
  if (!expression) return
  if (expression.op === 'has') {
    if (isConsumable(expression.var)) out.push(expression.var)
    return
  }
  if (expression.op === 'and' || expression.op === 'or') {
    for (const arg of expression.args) collect(arg, isConsumable, out)
  }
}

function walk(
  expression: GateExpression | null | undefined,
  caller: CallerState,
  index: VarIndex,
  isConsumable: (slug: string) => boolean,
  out: string[],
): void {
  if (!expression) return
  switch (expression.op) {
    case 'has':
      if (isConsumable(expression.var)) out.push(expression.var)
      return
    case 'lacks':
    case 'gte':
    case 'lte':
    case 'eq':
    case 'not':
      return
    case 'and':
      for (const arg of expression.args) walk(arg, caller, index, isConsumable, out)
      return
    case 'or': {
      // Only the branch that actually opened it. The caller reached here with a
      // passing gate, so at least one holds — but if the expression is stale
      // against the state (a solver exploring, a test) none may, and spending
      // nothing is the safe answer.
      const opener = expression.args.find((arg) => evaluate(arg, caller, index))
      if (opener) walk(opener, caller, index, isConsumable, out)
      return
    }
  }
}
