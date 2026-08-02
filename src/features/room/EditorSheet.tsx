import { useEffect, useMemo, useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { estimateSeconds, isLongNarration, LONG_NARRATION_SECONDS } from '@/lib/speech'
import { slugify } from '@/lib/slug'
import { nextFreeDigit } from './roomModel'
import { DIGITS, canWrite, type Digit, type StoryNode } from '@/types/domain'

/**
 * §4.2 — slides up over the room, ~70% height. Autosave on blur (F2.2); there is
 * deliberately no save button.
 */
export default function EditorSheet({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const graph = useDelve((s) => s.graph)
  const derived = useDelve((s) => s.derived)
  const role = useDelve((s) => s.role)
  const updateNode = useDelve((s) => s.updateNode)
  const updateChoice = useDelve((s) => s.updateChoice)
  const addChoice = useDelve((s) => s.addChoice)
  const deleteChoice = useDelve((s) => s.deleteChoice)

  const node = graph?.nodes.get(nodeId)
  const editable = canWrite(role)

  // Local draft so typing stays responsive; committed to the store on blur.
  const [draft, setDraft] = useState<Partial<StoryNode>>({})
  useEffect(() => setDraft({}), [nodeId])

  const value = <K extends keyof StoryNode>(key: K): StoryNode[K] =>
    (draft[key] ?? node?.[key]) as StoryNode[K]

  const commit = <K extends keyof StoryNode>(key: K) => {
    if (!node) return
    const next = draft[key]
    if (next === undefined || next === node[key]) return
    void updateNode(node.id, { [key]: next } as Partial<StoryNode>)
  }

  const outgoing = useMemo(
    () => (derived && node ? (derived.children.get(node.id) ?? []) : []),
    [derived, node],
  )

  const slugTaken = useMemo(() => {
    if (!graph || !node) return false
    const candidate = String(value('slug') ?? '')
    return [...graph.nodes.values()].some((n) => n.id !== node.id && n.slug === candidate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, node, draft.slug])

  if (!node || !graph || !derived) return null

  const narration = String(value('narration') ?? '')
  const seconds = estimateSeconds(narration)

  const field = 'w-full rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60'

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-mortar bg-depth p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm text-torch">Edit room</h3>
        <button onClick={onClose} className="text-sm text-mortar underline">
          Done
        </button>
      </div>

      {!editable && (
        <p className="mb-4 rounded border border-cold/60 bg-cold/10 p-3 text-xs">
          You have the <strong>{role ?? 'viewer'}</strong> role, so the story text is read-only.
          {role === 'voice' && ' You can still record audio and set status.'}
        </p>
      )}

      <fieldset disabled={!editable} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Title</span>
          <input
            className={field}
            value={String(value('title') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onBlur={() => commit('title')}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs uppercase tracking-wider text-mortar">
            <span>Narration</span>
            {/* F2.7 — live estimate, warn past 15s. */}
            <span className={isLongNarration(narration) ? 'text-grave' : 'text-mortar'}>
              {narration.length} chars · ~{seconds}s
              {isLongNarration(narration) && ` · over ${LONG_NARRATION_SECONDS}s`}
            </span>
          </span>
          <textarea
            rows={5}
            className={field}
            value={narration}
            onChange={(e) => setDraft((d) => ({ ...d, narration: e.target.value }))}
            onBlur={() => commit('narration')}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-mortar">Exits</span>
          {outgoing.length === 0 && <p className="text-xs text-cold">No exits yet.</p>}
          {outgoing.map((choice) => (
            <div key={choice.id} className="flex items-center gap-2">
              <select
                value={choice.digit}
                onChange={(e) => void updateChoice(choice.id, { digit: e.target.value as Digit })}
                className="rounded border border-mortar/60 bg-stone px-2 py-2"
              >
                {DIGITS.map((d) => {
                  // F2.5 — a digit already used by a sibling can't be picked.
                  const taken = outgoing.some((c) => c.id !== choice.id && c.digit === d)
                  return (
                    <option key={d} value={d} disabled={taken}>
                      {d}
                      {taken ? ' (used)' : ''}
                    </option>
                  )
                })}
              </select>
              <input
                defaultValue={choice.label}
                placeholder="Grab the harpoon"
                onBlur={(e) =>
                  e.target.value !== choice.label &&
                  void updateChoice(choice.id, { label: e.target.value })
                }
                className={field}
              />
              {/* F2.4 — destination picker: an existing node, or leave unwritten. */}
              <select
                value={choice.to_node_id ?? ''}
                onChange={(e) =>
                  void updateChoice(choice.id, { to_node_id: e.target.value || null })
                }
                className="max-w-[9rem] rounded border border-mortar/60 bg-stone px-2 py-2 text-xs"
              >
                <option value="">— unwritten —</option>
                {[...graph.nodes.values()]
                  .sort((a, b) => a.slug.localeCompare(b.slug))
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.slug}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => void deleteChoice(choice.id)}
                title="Remove exit"
                className="px-2 text-grave"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const digit = nextFreeDigit(derived, node.id)
              if (digit) void addChoice(node.id, digit)
            }}
            className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch"
          >
            + Add exit
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Node type</span>
          <select
            className={field}
            value={String(value('node_type'))}
            onChange={(e) => {
              const node_type = e.target.value as StoryNode['node_type']
              // F2.6 — converting to an ending strands whatever hung off it.
              if (node_type === 'ending' && outgoing.length > 0) {
                const ok = window.confirm(
                  `${node.slug} has ${outgoing.length} exit(s). Endings are read then hung up on, so those exits will never be offered. Convert anyway?`,
                )
                if (!ok) return
              }
              setDraft((d) => ({ ...d, node_type }))
              void updateNode(node.id, { node_type })
            }}
          >
            <option value="room">Room</option>
            <option value="ending">Ending</option>
          </select>
        </label>

        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-mortar">
            Timeout &amp; invalid keypress
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-mortar">Seconds to wait</span>
              <input
                type="number"
                min={1}
                max={60}
                className={field}
                value={Number(value('timeout_seconds') ?? 5)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, timeout_seconds: Number(e.target.value) }))
                }
                onBlur={() => commit('timeout_seconds')}
              />
            </label>
            {(['timeout_target_id', 'invalid_target_id'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-xs text-mortar">
                  {key === 'timeout_target_id' ? 'On silence' : 'On wrong keypress'}
                </span>
                <select
                  className={field}
                  value={String(value(key) ?? '')}
                  onChange={(e) => void updateNode(node.id, { [key]: e.target.value || null })}
                >
                  <option value="">Repeat this room</option>
                  {[...graph.nodes.values()].map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.slug}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">
            Production notes <span className="normal-case">(not heard by the caller)</span>
          </span>
          <textarea
            rows={2}
            className={field}
            value={String(value('notes') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            onBlur={() => commit('notes')}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-mortar">Slug</span>
          <input
            className={field}
            value={String(value('slug') ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, slug: slugify(e.target.value) }))}
            onBlur={() => !slugTaken && commit('slug')}
          />
          {slugTaken && <span className="text-xs text-grave">Another room already uses that slug.</span>}
        </label>
      </fieldset>
    </div>
  )
}
