import { useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { nearDuplicates } from './merge'
import { speakerHex } from './colors'

/**
 * The same person, cast twice.
 *
 * Offered, not applied. `Shark` and `Shark King` sit one letter inside the
 * threshold of things worth asking about and are obviously two characters —
 * only somebody who has read the story can tell, so this puts the pairs in
 * front of them and does nothing until they say.
 *
 * Which one survives is a choice, because the pair is often "the typo has one
 * line and the real one has twenty" but sometimes the other way round: the
 * FIRST spelling in the file is not necessarily the right one. The default is
 * whoever speaks more, and the arrow swaps it.
 */
export default function MergePanel() {
  const graph = useDelve((s) => s.graph)
  const merge = useDelve((s) => s.mergeCharacters)
  const [busy, setBusy] = useState<string | null>(null)
  /** Pairs the author has said are two different people. Not persisted: this
   *  panel is read once after an import, and a dismissal that outlived the
   *  session would hide a real duplicate made next week. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  /** Pairs the author has flipped, so the smaller side is the one that stays. */
  const [flipped, setFlipped] = useState<Set<string>>(new Set())

  const pairs = useMemo(() => (graph ? nearDuplicates(graph) : []), [graph])
  if (!graph) return null

  const linesOf = (id: string) =>
    [...graph.dialogue.values()].filter((l) => l.character_id === id).length

  const visible = pairs.filter((p) => !dismissed.has(`${p.keep.id}:${p.drop.id}`))
  if (visible.length === 0) return null

  return (
    <section className="mb-8">
      <h2 className="mb-1 font-carved uppercase tracking-[0.12em] text-torch">
        Might be the same person
      </h2>
      <p className="mb-3 text-xs text-cold">
        Names close enough to be a typo. Merging moves every line to the one you keep and rewrites
        the script to match — takes and recordings survive, and Undo puts it back.
      </p>

      <ul className="flex flex-col gap-2">
        {visible.map((pair) => {
          const key = `${pair.keep.id}:${pair.drop.id}`
          const swap = flipped.has(key)
          const keep = swap ? pair.drop : pair.keep
          const drop = swap ? pair.keep : pair.drop
          return (
            <li key={key} className="rounded border border-mortar/40 p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-carved" style={{ color: speakerHex(keep.color) }}>
                  {keep.name}
                </span>
                <span className="text-xs text-mortar">{linesOf(keep.id)} line(s) · kept</span>

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    setFlipped((f) => {
                      const next = new Set(f)
                      if (next.has(key)) next.delete(key)
                      else next.add(key)
                      return next
                    })
                  }
                  title={`Keep ${drop.name} instead`}
                  aria-label={`Keep ${drop.name} instead`}
                  className="rounded border border-mortar/50 px-2 text-xs text-mortar hover:border-torch hover:text-torch"
                >
                  ⇄
                </button>

                <span className="text-cold line-through">{drop.name}</span>
                <span className="text-xs text-mortar">{linesOf(drop.id)} line(s)</span>
                <span className="text-xs text-cold">· {pair.why}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setBusy(key)
                    void merge(keep.id, drop.id).finally(() => setBusy(null))
                  }}
                  className="rounded border border-torch/60 px-3 py-1.5 text-xs text-torch disabled:opacity-40"
                >
                  {busy === key ? 'Merging…' : `Merge into ${keep.name}`}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setDismissed((d) => new Set(d).add(key))}
                  className="rounded border border-mortar/50 px-3 py-1.5 text-xs text-mortar hover:border-torch"
                >
                  They are different people
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
