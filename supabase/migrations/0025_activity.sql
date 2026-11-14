-- The activity log: who changed what in a shared story, newest first, shown in
-- the bottom-right of the phone's flowchart. One row per edit (what Undo calls
-- it, and the scene it touched). Written through log_activity so the name on a
-- row is always the person who made it; read by anyone on the story. Not a
-- story table, so it doesn't bump edited_at.

create table if not exists story_activity (
  id bigserial primary key,
  story_id uuid not null references stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '',
  label text not null,
  scene_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists story_activity_story_time on story_activity (story_id, created_at desc);

alter table story_activity enable row level security;

drop policy if exists story_activity_select on story_activity;
create policy story_activity_select on story_activity for select to authenticated
  using (public.delve_role(story_id) is not null);

create or replace function public.log_activity(p_story uuid, p_label text, p_scene uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.delve_role(p_story), 'viewer') = 'viewer' then return; end if;
  insert into story_activity (story_id, user_id, email, label, scene_id)
  values (p_story, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), left(p_label, 200), p_scene);
end $$;

revoke all on function public.log_activity(uuid, text, uuid) from public;
grant execute on function public.log_activity(uuid, text, uuid) to authenticated;
