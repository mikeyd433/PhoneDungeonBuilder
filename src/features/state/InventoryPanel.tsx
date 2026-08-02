import { useDelve } from '@/features/graph/store'
import TakeRecorder from '@/features/audio/TakeRecorder'
import { keyCollisions } from '@/features/export/inventory'
import { canWrite, INVENTORY_KEYS, type InventoryKey } from '@/types/domain'

/**
 * "What am I carrying?", on the phone.
 *
 * Lives on the export screen because it is a decision about the SHAPE of the
 * compiled flow — turning it on adds a branch to every room's keypad and a
 * shared readback chain, and the widget meter two panels down is what says
 * whether the story can afford it.
 *
 * Everything here needs a recording: nothing in the exported flow is spoken by
 * Twilio, so an item nobody has read aloud is silence on the phone. The panel
 * says which ones, rather than letting the export be the first place you find
 * out.
 */
export default function InventoryPanel() {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const updateStory = useDelve((s) => s.updateStory)
  const setItemAudio = useDelve((s) => s.setItemAudio)
  if (!graph) return null

  const story = graph.story
  const editable = canWrite(role)
  const key = story.inventory_key
  const items = [...graph.stateVars.values()]
    .filter((v) => v.kind === 'item')
    .sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug))
  const collisions = keyCollisions(graph)
  const silent = items.filter((v) => !v.audio_path)

  return (
    <section className="rounded border border-mortar/40 p-4">
      <h2 className="mb-1 text-sm uppercase tracking-wider text-torch">Inventory readback</h2>
      <p className="mb-3 text-xs text-cold">
        One key the caller can press in any room to hear what they are carrying, before being put
        back where they were standing. Off unless you pick a key.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          disabled={!editable}
          onClick={() => void updateStory({ inventory_key: null })}
          className={[
            'rounded border px-3 py-1.5 text-xs disabled:opacity-40',
            key === null ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
          ].join(' ')}
        >
          Off
        </button>
        {INVENTORY_KEYS.map((k: InventoryKey) => (
          <button
            key={k}
            disabled={!editable}
            onClick={() => void updateStory({ inventory_key: k })}
            className={[
              'rounded border px-3 py-1.5 text-xs disabled:opacity-40',
              key === k ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
            ].join(' ')}
          >
            Press {k === '*' ? '★ star' : '# pound'}
          </button>
        ))}
        {/* Only these two. Every other key on the pad is a door in some room. */}
        <span className="text-xs text-cold">Only star and pound are never doors.</span>
      </div>

      {key && (
        <>
          {collisions.length > 0 && (
            <p className="mb-3 rounded border border-grave/50 bg-grave/10 p-2 text-xs">
              {collisions.join(', ')} already use {key} for a door, so the caller cannot check
              there. Move those doors to another key, or use the other one here.
            </p>
          )}

          <div className="mb-4 flex flex-col gap-3">
            <div>
              <p className="text-xs text-mortar">The lead-in — &ldquo;you are carrying…&rdquo;</p>
              <TakeRecorder
                name="inventory-intro"
                path={story.inventory_intro_audio_path}
                durationMs={story.inventory_intro_audio_duration_ms}
                onSaved={(path, ms) =>
                  updateStory({
                    inventory_intro_audio_path: path,
                    inventory_intro_audio_duration_ms: ms,
                  })
                }
              />
            </div>
            <div>
              <p className="text-xs text-mortar">Empty hands — &ldquo;you have nothing&rdquo;</p>
              <TakeRecorder
                name="inventory-empty"
                path={story.inventory_empty_audio_path}
                durationMs={story.inventory_empty_audio_duration_ms}
                onSaved={(path, ms) =>
                  updateStory({
                    inventory_empty_audio_path: path,
                    inventory_empty_audio_duration_ms: ms,
                  })
                }
              />
            </div>
          </div>

          <p className="mb-2 text-xs uppercase tracking-wider text-mortar">
            One take per item {silent.length > 0 && `· ${silent.length} still silent`}
          </p>
          {items.length === 0 ? (
            <p className="text-xs text-cold">
              This story has no items yet, so there is nothing to read back.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-mortar/25 p-2"
                >
                  <span className="min-w-0 flex-1 basis-40 text-sm">
                    {v.name || v.slug}
                    {v.name && v.name !== v.slug && (
                      <span className="ml-2 font-carved text-xs text-mortar">{v.slug}</span>
                    )}
                  </span>
                  <TakeRecorder
                    name={`item-${v.slug}`}
                    path={v.audio_path}
                    durationMs={v.audio_duration_ms}
                    onSaved={(path, ms) => setItemAudio(v.id, path, ms)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
