import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDelve } from '@/features/graph/store'
import { castList, suggestCast, workloads } from '@/features/cast/dialogue'
import { FIGURES, type FigureKind } from '@/types/domain'

/** What each silhouette is for, in the terms an author picks by. */
const FIGURE_LABELS: Record<FigureKind, string> = {
  standing: 'Standing — a person',
  looming: 'Looming — bigger than you',
  small: 'Small — a child, or something low',
  seated: 'Seated — not going anywhere',
  beast: 'Beast — on four legs',
}
import CallSheet from '@/features/cast/CallSheetPanel'
import { useCallSheets } from '@/features/cast/useCallSheets'
import { SPEAKER_COLORS, speakerHex } from '@/features/cast/colors'
import { slugify, uniqueSlug } from '@/lib/slug'
import { canWrite } from '@/types/domain'

/**
 * The cast list.
 *
 * Who speaks, who records them, and what each voice actor still owes. It does
 * not change the SHAPE of the compiled flow — no extra gathers, no branching —
 * so everything here is production bookkeeping, and it is deliberately kept off
 * the room screen where it would compete with the story.
 */
export default function Cast() {
  const { storyId } = useParams<{ storyId: string }>()
  const { graph, loading, error, loadStory } = useDelve()
  const role = useDelve((s) => s.role)
  const addCharacter = useDelve((s) => s.addCharacter)
  const editCharacter = useDelve((s) => s.editCharacter)
  const removeCharacter = useDelve((s) => s.removeCharacter)
  const [name, setName] = useState('')
  const sheets = useCallSheets()

  useEffect(() => {
    if (storyId && !graph) void loadStory(storyId)
  }, [storyId, graph, loadStory])

  if (loading || !graph) return <p className="p-6 text-mortar">{error ?? 'Reading the bill…'}</p>

  const editable = canWrite(role)
  const cast = castList(graph)
  const suggestions = suggestCast(graph)
  const queues = workloads(graph)
  const takenSlugs = () => cast.map((c) => c.slug)

  const create = async (displayName: string) => {
    const trimmed = displayName.trim()
    if (!trimmed) return
    await addCharacter({ slug: uniqueSlug(slugify(trimmed), takenSlugs()), name: trimmed })
  }

  const field =
    'rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch disabled:opacity-60'

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-6 flex items-center gap-3 text-sm">
        <Link to={`/story/${storyId}`} className="text-mortar underline">
          ◄
        </Link>
        <h1 className="font-carved uppercase tracking-[0.12em] text-torch">Cast</h1>
      </header>

      <section className="mb-8">
        {cast.length === 0 && (
          <p className="mb-3 text-sm text-cold">
            Nobody cast yet. Add someone below, or take one of the names already speaking in the
            script.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {cast.map((c) => (
            <li key={c.id} className="rounded border border-mortar/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="font-carved uppercase tracking-[0.12em]"
                  style={{ color: speakerHex(c.color) }}
                >
                  {c.name}
                </span>
                <span className="text-xs text-mortar">{c.slug}</span>
                <button
                  disabled={!editable}
                  onClick={() => void editCharacter(c.id, { is_playable: !c.is_playable })}
                  title="A character the caller can be"
                  className={[
                    'ml-auto rounded border px-2 py-1 text-xs disabled:opacity-40',
                    c.is_playable ? 'border-torch text-torch' : 'border-mortar/60 text-mortar',
                  ].join(' ')}
                >
                  playable
                </button>
                <button
                  disabled={!editable}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${c.name}? Their lines stay in the story; they just stop being attributed to anybody.`,
                      )
                    ) {
                      void removeCharacter(c.id)
                    }
                  }}
                  className="px-2 text-grave disabled:opacity-40"
                  title="Remove from the cast"
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  disabled={!editable}
                  defaultValue={c.voice_actor ?? ''}
                  placeholder="Voice actor"
                  onBlur={(e) =>
                    e.target.value !== (c.voice_actor ?? '') &&
                    void editCharacter(c.id, { voice_actor: e.target.value || null })
                  }
                  className={field}
                />
                <select
                  disabled={!editable}
                  value={c.color}
                  onChange={(e) => void editCharacter(c.id, { color: e.target.value })}
                  className={field}
                  style={{ color: speakerHex(c.color) }}
                >
                  {SPEAKER_COLORS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {/* Who is PRESENT, which is not the same question as who
                    speaks. The party is the caller and the narrator is nobody,
                    so this stays off unless somebody turns it on. */}
                <select
                  disabled={!editable}
                  value={c.figure ?? ''}
                  onChange={(e) =>
                    void editCharacter(c.id, {
                      figure: (e.target.value || null) as FigureKind | null,
                    })
                  }
                  title="Stand a figure in every room this character speaks in"
                  className={field}
                >
                  <option value="">— not in the room —</option>
                  {FIGURES.map((f) => (
                    <option key={f} value={f}>
                      {FIGURE_LABELS[f]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-mortar">
                  {[...graph.dialogue.values()].filter((l) => l.character_id === c.id).length} line(s)
                </span>
              </div>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void create(name)
            setName('')
          }}
          className="mt-4 flex gap-2"
        >
          <input
            disabled={!editable}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add someone — Carter, the bouncer, a voice on the radio"
            className={`${field} flex-1`}
          />
          <button
            disabled={!editable || !name.trim()}
            className="rounded border border-mortar px-3 py-2 text-sm hover:border-torch disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </section>

      {/* Names the script already uses that nobody has cast. */}
      {suggestions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 font-carved uppercase tracking-[0.12em] text-torch">
            Speaking, but not cast
          </h2>
          <p className="mb-3 text-xs text-cold">
            Found by reading every room&apos;s narration for a name followed by a colon.
          </p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.name} className="flex items-center gap-3 text-sm">
                <span className="text-parchment">{s.name}</span>
                <span className="text-xs text-mortar">
                  {s.lines} line(s) · {s.sampleSlugs.join(', ')}
                </span>
                <button
                  disabled={!editable}
                  onClick={() => void create(s.name)}
                  className="ml-auto rounded border border-mortar px-2 py-1 text-xs hover:border-torch disabled:opacity-40"
                >
                  Cast
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* What each actor still owes. The unit depends on how the room records;
          `workloads` is where that rule lives. */}
      {queues.length > 0 && (
        <section>
          <h2 className="mb-1 font-carved uppercase tracking-[0.12em] text-torch">
            Recording queue
          </h2>
          <p className="mb-3 text-xs text-cold">
            A room recorded as one file is booked for everyone in it, so it stays outstanding until
            that single take exists. A room recorded line by line is outstanding only for whoever
            is still missing their own lines. The call sheet is the page you hand them: their
            lines, in story order, named the way the importer expects them back.
          </p>
          <ul className="flex flex-col gap-3">
            {queues.map((q) => (
              <li key={q.actor ?? 'unassigned'} className="rounded border border-mortar/40 p-3">
                <div className="mb-1 flex items-baseline gap-2">
                  <span className={q.actor ? 'text-parchment' : 'text-cold'}>
                    {q.actor ?? 'No voice actor assigned'}
                  </span>
                  <span className="text-xs text-mortar">
                    {q.characters.join(', ') || 'unattributed lines'} · {q.lines} line(s)
                  </span>
                </div>
                {sheets.get(q.actor ?? ' unassigned') && (
                  <CallSheet
                    sheet={sheets.get(q.actor ?? ' unassigned')!}
                    storyTitle={graph.story.title}
                  />
                )}
                {q.unrecordedSlugs.length === 0 ? (
                  <p className="text-xs text-torch">Nothing outstanding.</p>
                ) : (
                  <p className="text-xs text-mortar">
                    {q.unrecordedSlugs.length} room(s) left
                    {q.unrecordedLines > 0 && `, ${q.unrecordedLines} of them line takes`}:{' '}
                    {q.unrecordedSlugs.slice(0, 12).join(', ')}
                    {q.unrecordedSlugs.length > 12 && ` … and ${q.unrecordedSlugs.length - 12} more`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
