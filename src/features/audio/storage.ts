import { supabase } from '@/lib/supabase'

export const AUDIO_BUCKET = 'story-audio'

/**
 * Storage path for a room's audio.
 *
 * The story id leads, because the Storage RLS policies read it out of the first
 * path segment to decide who may write (see migration 0004). The timestamp
 * suffix means a re-record never overwrites in place, so a cached Twilio Play
 * URL can't start serving different audio than the flow was built against.
 */
export function audioPath(storyId: string, slug: string, ext: string): string {
  return `${storyId}/${slug}-${Date.now()}.${ext}`
}

/** Public URL — the bucket is public precisely so Twilio can fetch this. */
export function publicAudioUrl(path: string): string {
  return supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function uploadAudio(path: string, blob: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  })
  if (error) throw error
}

/** Best-effort cleanup of a replaced clip. A failure here is not worth failing
 *  the save over — the row already points at the new file. */
export async function removeAudio(path: string): Promise<void> {
  try {
    await supabase.storage.from(AUDIO_BUCKET).remove([path])
  } catch {
    /* orphaned object; harmless */
  }
}

export async function downloadAudio(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path)
  if (error) return null
  return data
}
