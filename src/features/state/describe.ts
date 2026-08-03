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

/** Oxford-less list: "a, b or c". Two items get no comma. */
function join(parts: string[], word: 'and' | 'or'): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} ${word} ${parts[parts.length - 1]}`
}
