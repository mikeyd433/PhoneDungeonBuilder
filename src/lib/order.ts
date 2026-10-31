/**
 * Compare two strings by UTF-16 code unit — the same answer in every
 * JavaScript engine and in Kotlin's `String.compareTo`.
 *
 * NOT `localeCompare`: its result depends on the engine's collation tables
 * (Node's ICU ignores underscores at the first level; QuickJS, which runs the
 * exporter on the phone, compares raw codes), so a flow or build sheet sorted
 * with it came out in a different order on the phone than on the web. Use this
 * anywhere an order reaches an export, a pack or a flow.
 */
export function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
