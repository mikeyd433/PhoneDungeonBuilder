import { useState } from 'react'
import { useDelve } from '@/features/graph/store'
import { slugify, uniqueSlug } from '@/lib/slug'
import { castList, matchCharacter, playsLineByLine, splitNarration } from './dialogue'
import { speakerHex, SPEAKER_COLORS } from './colors'
import LineRecorder from './LineRecorder'
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

  // Audio is carried explicitly: saving replaces the rows, so a line's take
  // would be lost on every text edit if the patch didn't say which recording
  // belongs to which line.
  const asPatch = () =>
    lines.map((l) => ({
      character_id: l.character_id,
      text: l.text,
      audio_path: l.audio_path,
      audio_duration_ms: l.audio_duration_ms,
    }))

  const save = async (
    next: Array<{
      character_id: string | null
      text: string
      audio_path?: string | null
      audio_duration_ms?: number | null
    }>,
  ) => {
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

  const splitAudio = playsLineByLine(graph, nodeId)

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
            Not split. The room is one recording, and stays that way unless you record a line of
            its own — splitting says who says what, so a voice actor can be handed their own lines
            and a scene can be assembled from two separate sessions.
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
            <div key={line.id} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
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
              {/* A line only needs its own take when the scene is split between
                  actors who record apart. Recording one is what switches this
                  room from a single file to a line-by-line conversation. */}
              <LineRecorder lineId={line.id} />
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

          {splitAudio ? (
            <p className="text-xs text-torch">
              This room plays line by line: each take above is played in order, and only then are
              the exits offered. Lines with no take will be read by Studio&apos;s voice.
            </p>
          ) : (
            <p className="text-xs text-cold">
              This room is still one recording — the file on the room itself. Record a line above
              and it switches to playing line by line, which is how a scene split between two
              separately-booked actors gets assembled.
            </p>
          )}
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
