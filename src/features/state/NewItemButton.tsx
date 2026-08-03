import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import * as api from '@/lib/api'
import { errorText } from '@/lib/errorText'
import { slugify } from '@/lib/slug'

/**
 * Make an item without leaving what you were doing.
 *
 * Every control that asks about an item used to dead-end when the story had
 * none: the fork sheet said "create an item first, on the Items tab", and the
 * Items tab did not exist until a checkbox on a different tab was ticked. Three
 * surfaces to make one word.
 *
 * So the question and the answer live in the same place. `onCreated` hands back
 * the new slug, because the control that asked almost always wants to select it
 * straight away — a fork that makes an item and then does not use it has moved
 * the dead end rather than removed it.
 */
export default function NewItemButton({
  onCreated,
  label = '+ New item',
}: {
  onCreated?: (slug: string) => void | Promise<void>
  label?: string
}) {
  const graph = useDelve((s) => s.graph)
  const refresh = useDelve((s) => s.refresh)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!graph) return null

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const slug = slugify(trimmed)
      // Re-use rather than duplicate: two items with one slug would both be
      // written into the same inventory string and neither could be revoked.
      const existing = [...graph.stateVars.values()].find((v) => v.slug === slug)
      if (!existing) {
        await api.createStateVar(graph.story.id, { slug, name: trimmed, kind: 'item' })
        await refresh()
      }
      setName('')
      setOpen(false)
      await onCreated?.(slug)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded border border-mortar px-2 py-1.5 text-xs text-mortar hover:border-torch hover:text-torch"
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Tony Hawk's helmet"
          aria-label="Name of the new item"
          className="min-w-0 flex-1 basis-40 rounded border border-mortar/60 bg-stone px-2 py-1.5 text-sm outline-none focus:border-torch"
        />
        <button
          type="button"
          disabled={!name.trim() || busy}
          onClick={() => void create()}
          className="rounded border border-torch px-2 py-1.5 text-xs text-torch disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-mortar underline"
        >
          Cancel
        </button>
      </div>
      {/* The slug is what the exported flow tests and what every condition is
          written in terms of, so it is shown while it can still be influenced
          by what you type. */}
      {name.trim() && (
        <span className="font-carved text-xs text-mortar">{slugify(name)}</span>
      )}
      {error && <span className="text-xs text-grave">{error}</span>}
    </div>
  )
}
