import type { GateExpression } from '@/types/domain'

/**
 * Liquid generation for the Twilio Studio export (§6.1, §6.3).
 *
 * THE RULE THAT MATTERS: Studio's `contains` predicate matches substrings, so
 * testing for `ROPE` would also match `ROPEBURN`. Every stored value and every
 * test value is therefore wrapped in pipes — `|ROPE|` cannot match `|ROPEBURN|`.
 *
 * The spec calls this "the kind of bug that surfaces three weeks into
 * recording", which is exactly why the wrapping lives in one function that
 * everything else calls, and why it is unit-tested rather than trusted.
 */

/** The flow variable holding the whole inventory as a delimited string. */
export const INV_VAR = 'inv'

/** Counters get their own flow variables, since a string can't hold arithmetic. */
export function counterVar(slug: string): string {
  return `c_${slug}`
}

/** The ONLY way an item should ever be written into a test or a stored value. */
export function delimited(slug: string): string {
  return `|${slug}|`
}

/** Grant — idempotent, so picking the same item up twice doesn't duplicate it. */
export function grantLiquid(slug: string): string {
  return (
    `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}` +
    `{% if cur contains "${delimited(slug)}" %}{{ cur }}` +
    `{% else %}{{ cur }}${slug}|{% endif %}`
  )
}

/** Revoke — replacing `|SLUG|` with `|` keeps the delimiters intact for
 *  neighbouring entries. */
export function revokeLiquid(slug: string): string {
  return `{{ flow.variables.${INV_VAR} | replace: "${delimited(slug)}", "|" }}`
}

export function counterAddLiquid(slug: string, amount: number): string {
  const op = amount < 0 ? 'minus' : 'plus'
  return `{{ flow.variables.${counterVar(slug)} | default: 0 | ${op}: ${Math.abs(amount)} }}`
}

export function counterSetLiquid(_slug: string, amount: number): string {
  return String(amount)
}

/**
 * Compile a gate expression to a Liquid boolean.
 *
 * §6.3: Studio's Split Based On tests one variable against a list of
 * alternatives, so there is no native way to express a conjunction. The fix is
 * to precompute the whole boolean in Liquid and split on the result — arbitrary
 * gate logic collapses to exactly two widgets.
 */
export function gateConditionLiquid(expression: GateExpression): string {
  return compile(expression)
}

function compile(e: GateExpression): string {
  switch (e.op) {
    case 'has':
      return `inv contains "${delimited(e.var)}"`
    case 'lacks':
      return `inv contains "${delimited(e.var)}" == false`
    case 'gte':
      return `${localCounter(e.var)} >= ${e.value}`
    case 'lte':
      return `${localCounter(e.var)} <= ${e.value}`
    case 'eq':
      return `${localCounter(e.var)} == ${e.value}`
    case 'and':
      // An empty `and` is vacuously true — a gate with no conditions is open.
      return e.args.length === 0 ? 'true' : e.args.map(compile).join(' and ')
    case 'or':
      return e.args.length === 0 ? 'false' : e.args.map(compile).join(' or ')
    case 'not': {
      const inner = e.args[0]
      // Liquid has no `not` operator, so negation has to be pushed down to the
      // leaves. This is why `not` is only supported over a single leaf.
      if (inner.op === 'has') return compile({ op: 'lacks', var: inner.var })
      if (inner.op === 'lacks') return compile({ op: 'has', var: inner.var })
      if (inner.op === 'gte') return `${localCounter(inner.var)} < ${inner.value}`
      if (inner.op === 'lte') return `${localCounter(inner.var)} > ${inner.value}`
      if (inner.op === 'eq') return `${localCounter(inner.var)} != ${inner.value}`
      return 'true'
    }
    default:
      return 'true'
  }
}

function localCounter(slug: string): string {
  return `v_${slug}`
}

/** Every counter an expression reads, so the preamble can bind them. */
export function countersUsed(e: GateExpression): string[] {
  switch (e.op) {
    case 'gte':
    case 'lte':
    case 'eq':
      return [e.var]
    case 'and':
    case 'or':
      return e.args.flatMap(countersUsed)
    case 'not':
      return countersUsed(e.args[0])
    default:
      return []
  }
}

/**
 * A complete gate evaluation: bind locals, then assign "pass" or "fail".
 *
 * §6.3 batches every gate on a node into ONE Set Variables widget, so a node
 * with three gated choices costs 1 set-variables + 3 splits, not 6 widgets.
 */
export function gateAssignmentLiquid(expression: GateExpression): string {
  const counters = [...new Set(countersUsed(expression))]
  const preamble =
    `{% assign inv = flow.variables.${INV_VAR} | default: "|" %}` +
    counters
      .map((c) => `{% assign ${localCounter(c)} = flow.variables.${counterVar(c)} | default: 0 %}`)
      .join('')
  return `${preamble}{% if ${compile(expression)} %}pass{% else %}fail{% endif %}`
}

/** Variable name for a gate's result, per §6.3's `gate_SHARKS_1_d2`. */
export function gateVarName(slug: string, digit: string): string {
  return `gate_${slug}_d${digitToken(digit)}`
}

/** Which alternate reading of a room is playing. `0` is the room's own. */
export function readingVarName(slug: string): string {
  return `read_${slug}`
}

/**
 * The whole if/elsif chain for a room's alternate readings, as ONE variable.
 *
 * Studio's Split Based On tests a single value, so N readings could have cost N
 * splits. Numbering them in Liquid instead collapses the choice to one
 * set-variables plus one split, whatever N is — the same trick §6.3 plays on
 * gates, for the same reason.
 *
 * Order is the author's: first match wins, and `0` means none matched and the
 * room reads itself out as it always did.
 */
export function readingAssignmentLiquid(expressions: GateExpression[]): string {
  const counters = [...new Set(expressions.flatMap(countersUsed))]
  const preamble =
    `{% assign inv = flow.variables.${INV_VAR} | default: "|" %}` +
    counters
      .map((c) => `{% assign ${localCounter(c)} = flow.variables.${counterVar(c)} | default: 0 %}`)
      .join('')
  const chain = expressions
    .map((e, i) => `{% ${i === 0 ? 'if' : 'elsif'} ${compile(e)} %}${i + 1}`)
    .join('')
  return `${preamble}${chain}{% else %}0{% endif %}`
}

/**
 * Spend the consumables a gate just took, without disturbing the rest.
 *
 * A revoke is a string replace on the delimited inventory, so several of them
 * chain: each `replace` runs on the result of the last. Built as one assignment
 * because the whole point is that it is a single value written back to `inv`.
 *
 * `or` is why this takes a state-free expression and still gets the right
 * answer: only the branch that HELD is replaced, and replacing an item the
 * caller never had is a no-op on the string. So "spend the crowbar or the key"
 * emits both replaces and takes exactly the one they were carrying — and when
 * they carry both, the guard below stops at the first.
 */
export function consumeLiquid(slugs: string[]): string {
  if (slugs.length === 0) return `{{ flow.variables.${INV_VAR} | default: "|" }}`
  const first = `{% assign cur = flow.variables.${INV_VAR} | default: "|" %}`
  const steps = slugs
    .map(
      (slug) =>
        `{% if cur contains "${delimited(slug)}" and spent == false %}` +
        `{% assign cur = cur | replace: "${delimited(slug)}", "|" %}` +
        `{% assign spent = true %}{% endif %}`,
    )
    .join('')
  return `${first}{% assign spent = false %}${steps}{{ cur }}`
}

/**
 * The same, for a gate that required ALL of them — every one is spent.
 *
 * Kept separate rather than parameterised by a flag: the two are different
 * sentences ("spend the one that opened it" / "spend all of them") and reading
 * `consumeLiquid(slugs, true)` at the call site tells you neither.
 */
export function consumeAllLiquid(slugs: string[]): string {
  if (slugs.length === 0) return `{{ flow.variables.${INV_VAR} | default: "|" }}`
  const replaces = slugs
    .map((slug) => ` | replace: "${delimited(slug)}", "|"`)
    .join('')
  return `{{ flow.variables.${INV_VAR} | default: "|"${replaces} }}`
}

/** `*` and `#` are not legal in a Liquid variable name. */
function digitToken(digit: string): string {
  if (digit === '*') return 'star'
  if (digit === '#') return 'hash'
  return digit
}
