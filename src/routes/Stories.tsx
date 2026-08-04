import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createStory, listStories, updateStory } from '@/lib/api'
import BuildButton from '@/features/app/BuildButton'
import { supabase } from '@/lib/supabase'
import type { Story } from '@/types/domain'
import { errorText } from '@/lib/errorText'

/** F7.3 — multi-story support. */
export default function Stories() {
  const [stories, setStories] = useState<Story[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which story is being renamed. Only ever one — a row at a time is how
   *  this is actually used, and it keeps the list scannable while you type. */
  const [renaming, setRenaming] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    listStories()
      .then(setStories)
      .catch((e) => setError(e.message))
  }, [])

  async function create() {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const story = await createStory(title.trim())
      navigate(`/story/${story.id}`)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  /**
   * Rename a story.
   *
   * Here rather than inside one, because the title is the thing this list is
   * FOR — and once you are in a story the header is the room's name, which is
   * a different question. It is also the name on every call sheet and on the
   * flow Studio imports, so a story called "Untitled" from a hurried first
   * session follows an actor around until somebody can change it.
   *
   * Written straight through: the story graph is not loaded on this screen, so
   * there is no undo stack to push onto. It is one text field and the old name
   * is a retype away.
   */
  async function rename(id: string, next: string) {
    const trimmed = next.trim()
    const was = stories.find((s) => s.id === id)
    setRenaming(null)
    if (!was || !trimmed || trimmed === was.title) return
    // Applied locally first so the list does not flicker back to the old name
    // while the write is in the air; rolled back if it is rejected.
    setStories((list) => list.map((s) => (s.id === id ? { ...s, title: trimmed } : s)))
    try {
      await updateStory(id, { title: trimmed })
    } catch (e) {
      setStories((list) => list.map((s) => (s.id === id ? was : s)))
      setError(errorText(e))
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl text-torch">Jackie Dungeon</h1>
        {/* Here as well as in a story: this is the screen you land on, so it is
            where "has my deploy landed" gets asked with nothing open yet. */}
        <BuildButton />
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-mortar underline"
        >
          Sign out
        </button>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm text-mortar">Your dungeons</h2>
        {stories.length === 0 ? (
          <p className="text-sm text-cold">Nothing dug yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {stories.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded border border-mortar/40 bg-stone px-2 py-2"
              >
                {renaming === s.id ? (
                  <input
                    autoFocus
                    defaultValue={s.title}
                    aria-label={`Rename ${s.title}`}
                    onBlur={(e) => void rename(s.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      // Escape abandons it: blur without the change reaching
                      // the write, the same as renaming a room.
                      if (e.key === 'Escape') {
                        e.currentTarget.value = s.title
                        e.currentTarget.blur()
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-torch bg-depth px-2 py-1.5 font-carved uppercase tracking-[0.12em] text-torch outline-none"
                  />
                ) : (
                  <>
                    <Link
                      to={`/story/${s.id}`}
                      className="min-w-0 flex-1 truncate px-2 py-1.5 font-carved uppercase tracking-[0.12em] hover:text-torch"
                    >
                      {s.title}
                    </Link>
                    <button
                      onClick={() => setRenaming(s.id)}
                      title={`Rename ${s.title}`}
                      aria-label={`Rename ${s.title}`}
                      className="shrink-0 rounded border border-mortar/45 px-3 py-1.5 text-xs text-mortar hover:border-torch hover:text-torch"
                    >
                      ✎ Rename
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm text-mortar">Dig a new one</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="Title"
          className="rounded border border-mortar/60 bg-stone px-3 py-2 outline-none focus:border-torch"
        />
        <button
          onClick={create}
          disabled={busy || !title.trim()}
          className="rounded bg-torch px-4 py-2 font-carved uppercase tracking-[0.12em] text-depth disabled:opacity-50"
        >
          Break ground
        </button>
        {error && <p className="text-sm text-grave">{error}</p>}
      </section>
    </main>
  )
}
