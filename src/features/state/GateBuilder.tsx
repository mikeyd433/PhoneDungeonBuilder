import type { StateVar } from '@/types/domain'
import { type FlatGate, type Leaf } from './gateShape'

/**
 * F8.4 — a visual gate builder. Tap to add conditions, AND/OR/NOT toggles, no
 * typing expressions. §2 is explicit that the JSON tree is "built in the UI,
 * never typed by hand".
 *
 * The editor deliberately supports one level of grouping — a root AND/OR over
 * leaves, each optionally negated. That covers "has harpoon AND lacks wound AND
 * rope >= 3", which §2 says is essentially every gate a phone adventure needs,
 * without inflicting a nested tree editor on a tablet.
 */

const OPS: Array<{ op: Leaf['op']; label: string; needsValue: boolean }> = [
  { op: 'has', label: 'has', needsValue: false },
  { op: 'lacks', label: 'lacks', needsValue: false },
  { op: 'gte', label: 'at least', needsValue: true },
  { op: 'lte', label: 'at most', needsValue: true },
  { op: 'eq', label: 'exactly', needsValue: true },
]

export default function GateBuilder({
  flat,
  vars,
  onChange,
}: {
  flat: FlatGate
  vars: StateVar[]
  onChange: (next: FlatGate) => void
}) {
  const setLeaf = (i: number, leaf: Leaf) => {
    const leaves = [...flat.leaves]
    leaves[i] = leaf
    onChange({ ...flat, leaves })
  }

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  return (
    <div className="flex flex-col gap-2">
      {flat.leaves.length > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-mortar">Caller must satisfy</span>
          {(['and', 'or'] as const).map((op) => (
            <button
              key={op}
              onClick={() => onChange({ ...flat, root: op })}
              className={[
                'rounded border px-2 py-1 uppercase tracking-wider',
                flat.root === op ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
              ].join(' ')}
            >
              {op === 'and' ? 'all' : 'any'}
            </button>
          ))}
        </div>
      )}

      {flat.leaves.map((leaf, i) => {
        const spec = OPS.find((o) => o.op === leaf.op)!
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={leaf.op}
              onChange={(e) => {
                const op = e.target.value as Leaf['op']
                const needsValue = OPS.find((o) => o.op === op)!.needsValue
                setLeaf(
                  i,
                  needsValue
                    ? { op: op as 'gte', var: leaf.var, value: 'value' in leaf ? leaf.value : 1 }
                    : ({ op, var: leaf.var } as Leaf),
                )
              }}
              className={field}
            >
              {OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              value={leaf.var}
              onChange={(e) => setLeaf(i, { ...leaf, var: e.target.value })}
              className={field}
            >
              {vars.map((v) => (
                <option key={v.id} value={v.slug}>
                  {v.slug}
                </option>
              ))}
            </select>

            {spec.needsValue && (
              <input
                type="number"
                value={'value' in leaf ? leaf.value : 0}
                onChange={(e) =>
                  setLeaf(i, { ...leaf, value: Number(e.target.value) } as Leaf)
                }
                className={`${field} w-20`}
              />
            )}

            <button
              onClick={() => onChange({ ...flat, leaves: flat.leaves.filter((_, j) => j !== i) })}
              className="px-2 text-grave"
              aria-label="Remove condition"
            >
              ✕
            </button>
          </div>
        )
      })}

      <button
        disabled={vars.length === 0}
        onClick={() =>
          onChange({
            ...flat,
            leaves: [...flat.leaves, { op: 'has', var: vars[0]?.slug ?? '' }],
          })
        }
        className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
      >
        + Add condition
      </button>

      {vars.length === 0 && (
        <p className="text-xs text-cold">Create an item first and it can be required here.</p>
      )}
    </div>
  )
}
