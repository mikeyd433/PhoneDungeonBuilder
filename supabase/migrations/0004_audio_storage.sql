-- Audio storage.
--
-- The bucket is PUBLIC by deliberate decision: Twilio's Play widget fetches the
-- URL from Twilio's own infrastructure with no Supabase session, so a private
-- bucket would need signed URLs — and a signed URL baked into an exported Studio
-- flow expires and breaks the phone line silently, weeks later. Public read is
-- the correct trade here. Writes are still restricted to members.
--
-- Path convention: <story_id>/<slug>-<timestamp>.<ext>
-- The first path segment being the story id is what makes the policies below
-- cheap — the story is known without joining through nodes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'story-audio',
  'story-audio',
  true,
  52428800, -- 50 MB; a room's narration is seconds long, this is generous
  array[
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read: that is the point of a public bucket, and Twilio depends on it.
create policy "story audio is publicly readable"
  on storage.objects for select
  using (bucket_id = 'story-audio');

-- Writing requires a role that is allowed to record — owner, writer or voice.
-- `voice` is included here precisely because recording is that role's whole job.
create policy "members may upload story audio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'story-audio'
    and public.delve_role((storage.foldername(name))[1]::uuid) in ('owner', 'writer', 'voice')
  );

create policy "members may replace story audio"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'story-audio'
    and public.delve_role((storage.foldername(name))[1]::uuid) in ('owner', 'writer', 'voice')
  );

create policy "members may delete story audio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'story-audio'
    and public.delve_role((storage.foldername(name))[1]::uuid) in ('owner', 'writer', 'voice')
  );
