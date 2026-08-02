import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { slugify, uniqueSlug } from '@/lib/slug'
import { castList, matchCharacter, splitNarration } from './dialogue'
import { speakerHex, SPEAKER_COLORS } from './colors'
import { canWrite } from '@/types/domain'

/**
 * A room's narration, split by who says it (§4.2's editor sheet).
 *
 * The split is a per-room decision, not a migration: a room nobody has split is
 * one block of text and behaves exactly as it always did. Splitting is offered,
 * never done automatically, because the parser guesses and a wrong guess in 143
 * rooms at once would be much harder to undo than to avoid.
 */
export default function DialogueSection({ nodeId }: { nodeId: string }) {
  const graph = useDelve((s) => s.graph)
  const role = useDelve((s) => s.role)
  const saveDialogue = useDelve((s) => s.saveDialogue)
  const addCharacter = useDelve((s) => s.addCharacter)
  const [busy, setBusy] = useState(false)

  const node = graph?.nodes.get(nodeId)
  if (!graph || !node) return null

  const editable = canWrite(role)
  const cast = castList(graph)
  const lines = [...graph.dialogue.values()]
    .filter((l) => l.node_id === nodeId)
    .sort((a, b) => a.sort_order - b.sort_order)

  const asPatch = () => lines.map((l) => ({ character_id: l.character_id, text: l.text }))

  const save = async (next: Array<{ character_id: string | null; text: string }>) => {
    setBusy(true)
    await saveDialogue(nodeId, next)
    setBusy(false)
  }

  /**
   * Split the narration, casting anybody new as we go.
   *
   * Creating the missing characters is the whole point: a story imported from a
   * flowchart has dozens of speakers and none of them are in the cast yet, so a
   * split that quietly dropped every unknown name would produce a script with
   * no speakers in it.
   */
  const splitNow = async () => {
    setBusy(true)
    const parsed = splitNarration(node.narration)
    const taken = new Set([...graph.characters.values()].map((c) => c.slug))

    for (const name of new Set(
      parsed.map((p) => p.speaker).filter((s): s is string => Boolean(s)),
    )) {
      if (matchCharacter(graph, name)) continue
      const slug = uniqueSlug(slugify(name), taken)
      taken.add(slug)
      await addCharacter({ slug, name })
    }

    // Re-read: addCharacter has been writing into the store all along.
    const fresh = useDelve.getState().graph ?? graph
    await saveDialogue(
      nodeId,
      parsed.map((p) => ({
        character_id: p.speaker ? (matchCharacter(fresh, p.speaker)?.id ?? null) : null,
        text: p.text,
      })),
    )
    setBusy(false)
  }

  const field =
    'w-full rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60'

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wider text-mortar">
        Lines {lines.length > 0 && <span className="normal-case">({lines.length})</span>}
      </span>

      {lines.length === 0 ? (
        <>
          <p className="text-xs text-cold">
            Not split. The room is still recorded as one file either way — splitting only says who
            says what, so a voice actor can be handed their own lines.
          </p>
          <button
            disabled={!editable || busy || !node.narration.trim()}
            onClick={() => void splitNow()}
            className="self-start rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
          >
            Split into lines
          </button>
        </>
      ) : (
        <>
          {lines.map((line, i) => (
            <div key={line.id} className="flex items-start gap-2">
              <select
                disabled={!editable || busy}
                value={line.character_id ?? ''}
                onChange={(e) => {
                  const next = asPatch()
                  next[i] = { ...next[i], character_id: e.target.value || null }
                  void save(next)
                }}
                className="w-28 shrink-0 rounded border border-mortar/60 bg-stone px-2 py-2 text-xs"
                style={{ color: speakerHex(graph.characters.get(line.character_id ?? '')?.color) }}
              >
                <option value="">— nobody —</option>
                {cast.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <textarea
                disabled={!editable || busy}
                rows={2}
                defaultValue={line.text}
                onBlur={(e) => {
                  if (e.target.value === line.text) return
                  const next = asPatch()
                  next[i] = { ...next[i], text: e.target.value }
                  void save(next)
                }}
                className={field}
              />
              <div className="flex shrink-0 flex-col">
                <button
                  disabled={!editable || busy || i === 0}
                  onClick={() => {
                    const next = asPatch()
                    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                    void save(next)
                  }}
                  title="Move up"
                  className="px-2 text-mortar disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  disabled={!editable || busy}
                  onClick={() => void save(asPatch().filter((_, j) => j !== i))}
                  title="Remove line"
                  className="px-2 text-grave disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          <div className="flex gap-2">
            <button
              disabled={!editable || busy}
              onClick={() => void save([...asPatch(), { character_id: null, text: '' }])}
              className="rounded border border-mortar px-3 py-2 text-xs hover:border-torch disabled:opacity-40"
            >
              + Add line
            </button>
            <button
              disabled={!editable || busy}
              onClick={() => void save([])}
              title="Keep the narration, drop the attributions"
              className="rounded border border-mortar/60 px-3 py-2 text-xs text-mortar disabled:opacity-40"
            >
              Unsplit
            </button>
          </div>

          <p className="text-xs text-cold">
            The narration above is rebuilt from these lines every time you change one, so what gets
            recorded and what the script says can&apos;t drift apart.
          </p>
        </>
      )}

      {cast.length === 0 && (
        <p className="text-xs text-cold">
          Nobody is in the cast yet. Splitting a room adds whoever it finds, or add them by hand on
          the Cast page. Colours available: {SPEAKER_COLORS.map((c) => c.name).join(', ')}.
        </p>
      )}
    </div>
  )
}
