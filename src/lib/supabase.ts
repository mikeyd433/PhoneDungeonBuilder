import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * Whether Supabase is wired up. The app still builds and boots without it and
 * says so on the login screen, rather than throwing a blank white page — the
 * same posture Stroke Off takes, and it keeps Netlify preview builds usable
 * before the env vars are set.
 */
export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'https://placeholder.supabase.co', key ?? 'placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
