import type { GateExpression } from '@/types/domain'

/** Just enough of a state var to name it. Takes a list rather than the graph so
 *  the gate builder, which is handed vars and not a story, can call it too. */
export interface NamedVar {
  slug: string
  name: string
}

/**
 * A condition, in the words the author wrote rather than the ones the compiler
 * reads.
 *
 * `{op:'or',args:[{op:'has',var:'CROWBAR'},{op:'has',var:'MASTER_KEY'}]}` is
 * unambiguous and unreadable, and it is the shape of the most common question
 * in an item story — *either* of these opens it. The gate builder showed that
 * as two rows and a two-letter toggle, which is exactly enough to build the
 * wrong thing and not notice.
 *
 * So: one sentence, on the call sheet, in the editor, and in the ledger. The
 * item's NAME is used where there is one — "a coil of rope" is what the story
 * is about; ROPE is what the export tests — falling back to the slug for a var
 * nobody has named.
 */
export function describeExpression(
  vars: NamedVar[],
  expression: GateExpression | null | undefined,
): string {
  if (!expression) return 'always'
  return phrase(vars, expression) || 'always'
}

function nameOf(vars: NamedVar[], slug: string): string {
  return vars.find((v) => v.slug === slug)?.name?.trim() || slug
}

/** "A coil of rope" is how the story names it and "No A coil of rope" is not a
 *  sentence. The article goes for the chip and stays everywhere else. */
function bare(name: string): string {
  return name.replace(/^(a|an|the)\s+/i, '')
}

function phrase(vars: NamedVar[], e: GateExpression): string {
  switch (e.op) {
    case 'has':
      return `carrying ${nameOf(vars, e.var)}`
    case 'lacks':
      return `not carrying ${nameOf(vars, e.var)}`
    case 'gte':
      return `${nameOf(vars, e.var)} is ${e.value} or more`
    case 'lte':
      return `${nameOf(vars, e.var)} is ${e.value} or fewer`
    case 'eq':
      return `${nameOf(vars, e.var)} is exactly ${e.value}`
    case 'and':
      // An empty `and` requires nothing, which is the state a freshly added
      // condition is in — and saying "always" out loud is the fastest way for
      // an author to notice a variant that will swallow every case below it.
      if (e.args.length === 0) return 'always'
      return join(
        e.args.map((a) => phrase(vars, a)),
        'and',
      )
    case 'or':
      if (e.args.length === 0) return 'never'
      return join(
        e.args.map((a) => phrase(vars, a)),
        'or',
      )
    case 'not': {
      const inner = e.args[0]
      if (inner.op === 'has') return phrase(vars, { op: 'lacks', var: inner.var })
      if (inner.op === 'lacks') return phrase(vars, { op: 'has', var: inner.var })
      return `not (${phrase(vars, inner)})`
    }
  }
}

/**
 * The same condition, short enough to sit on a tab.
 *
 * "carrying a coil of rope" is the right sentence to read in the editor and the
 * wrong one to fit on a chip beside three others. `Has rope` / `No rope` is how
 * an author says it out loud, so that is what the switcher wears — and anything
 * more complicated than one item falls back to a count, because a tab that
 * wraps to three lines is worse than one that admits it is summarising.
 */
export function shortCondition(vars: NamedVar[], expression: GateExpression | null): string {
  if (!expression) return 'Always'
  if (expression.op === 'has') return `Has ${bare(nameOf(vars, expression.var))}`
  if (expression.op === 'lacks') return `No ${bare(nameOf(vars, expression.var))}`
  if (expression.op === 'gte') return `${nameOf(vars, expression.var)} ≥ ${expression.value}`
  if (expression.op === 'lte') return `${nameOf(vars, expression.var)} ≤ ${expression.value}`
  if (expression.op === 'eq') return `${nameOf(vars, expression.var)} = ${expression.value}`
  if (expression.op === 'not') return shortCondition(vars, expression.args[0]).startsWith('Has ')
    ? shortCondition(vars, expression.args[0]).replace(/^Has /, 'No ')
    : `Not ${shortCondition(vars, expression.args[0])}`
  if (expression.op === 'and' || expression.op === 'or') {
    if (expression.args.length === 0) return expression.op === 'and' ? 'Always' : 'Never'
    if (expression.args.length === 1) return shortCondition(vars, expression.args[0])
    // Two is still readable; beyond that the sentence in the editor is the
    // place to read it, and the chip only has to be tellable apart.
    if (expression.args.length === 2) {
      return expression.args
        .map((a) => shortCondition(vars, a))
        .join(expression.op === 'and' ? ' + ' : ' / ')
    }
    return `${expression.args.length} ${expression.op === 'and' ? 'all' : 'any'}`
  }
  return 'Always'
}

/** Oxford-less list: "a, b or c". Two items get no comma. */
function join(parts: string[], word: 'and' | 'or'): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`
}
