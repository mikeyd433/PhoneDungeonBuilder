import { useState, type FormEvent } from 'react'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { describeAuthError } from '@/features/auth/authError'

/** F7.1 — magic link, the same pattern as Stroke Off. */
export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    setBusy(false)
    if (error) setError(describeAuthError(error))
    else setSent(true)
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-xl text-torch">The Delve</h1>
        <p className="mt-2 text-sm text-mortar">
          A dungeon-crawl authoring tool for a phone adventure.
        </p>
      </header>

      {!supabaseConfigured ? (
        <p className="rounded border border-grave/60 bg-grave/10 p-4 text-sm">
          Supabase isn&apos;t configured. Set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> and reload.
        </p>
      ) : sent ? (
        <p className="rounded border border-torch/40 bg-torch/10 p-4 text-sm">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="text-sm text-mortar" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-mortar/60 bg-stone px-3 py-2 text-parchment outline-none focus:border-torch"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-torch px-4 py-2 font-carved uppercase tracking-[0.12em] text-depth disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
          {error && <p className="text-sm text-grave">{error}</p>}
        </form>
      )}
    </main>
  )
}
