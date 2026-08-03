import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createStory, listStories } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type { Story } from '@/types/domain'

/** F7.3 — multi-story support. */
export default function Stories() {
  const [stories, setStories] = useState<Story[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl text-torch">Jackie Dungeon</h1>
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
              <li key={s.id}>
                <Link
                  to={`/story/${s.id}`}
                  className="block rounded border border-mortar/40 bg-stone px-4 py-3 hover:border-torch"
                >
                  <span className="font-carved uppercase tracking-[0.12em]">{s.title}</span>
                </Link>
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
