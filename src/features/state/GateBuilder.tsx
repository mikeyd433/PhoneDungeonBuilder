import type { StateVar } from '@/types/domain'
import { type FlatGate, type Leaf } from './gateShape'
import { fromFlat } from './gateShape'
import { describeExpression } from './describe'
import NewItemButton from './NewItemButton'

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
  /** Make an item and use it in one go. Creating one and leaving it unselected
   *  would move the dead end rather than remove it. */
  const addWithNew = (slug: string) =>
    onChange({ ...flat, leaves: [...flat.leaves, { op: 'has', var: slug }] })

  const setLeaf = (i: number, leaf: Leaf) => {
    const leaves = [...flat.leaves]
    leaves[i] = leaf
    onChange({ ...flat, leaves })
  }

  const field = 'rounded border border-mortar/60 bg-stone px-2 py-2 text-sm'

  return (
    <div className="flex flex-col gap-2">
      {/* Two items that BOTH work is the commonest thing an item story wants —
          the crowbar or the master key — and it used to be two bare words that
          only appeared once you had already added a second condition. Now the
          choice is spelled out, and each option says what it means, because
          picking the wrong one of these builds a door nobody can open. */}
      {flat.leaves.length > 1 && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-mortar">The caller needs</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['and', 'all of these', 'Every condition below must hold.'],
                ['or', 'any one of these', 'Any single one is enough — two different items can both work.'],
              ] as const
            ).map(([op, label, hint]) => (
              <button
                key={op}
                type="button"
                title={hint}
                onClick={() => onChange({ ...flat, root: op })}
                className={[
                  'flex-1 basis-40 rounded border px-2 py-1.5 text-left',
                  flat.root === op ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
                ].join(' ')}
              >
                <span className="block">{label}</span>
                <span className="block text-cold">{hint}</span>
              </button>
            ))}
          </div>
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={vars.length === 0}
          onClick={() =>
            onChange({
              ...flat,
              leaves: [...flat.leaves, { op: 'has', var: vars[0]?.slug ?? '' }],
            })
          }
          className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
        >
          + Add condition
        </button>
        {/* The answer beside the question. This control used to send you to
            another tab that did not exist yet. */}
        <NewItemButton
          label={vars.length === 0 ? '+ Create the first item' : '+ New item'}
          onCreated={addWithNew}
        />
      </div>

      {/* What the rows above actually say, as a sentence. Two conditions and a
          toggle are easy to read as the opposite of what they are, and the one
          place that misreading shows up otherwise is a phone call. */}
      {flat.leaves.length > 0 && (
        <p className="text-xs text-cold">
          Reads as: <span className="text-mortar">{describeExpression(vars, fromFlat(flat))}</span>
        </p>
      )}


    </div>
  )
}
