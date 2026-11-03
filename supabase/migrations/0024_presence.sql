-- Who else is in a story right now, and which scene they have open (the phone's
-- flowchart and the car show a marker on it; a sheet says "Friend is in this
-- scene"). Each phone writes its own row every few seconds while the app is
-- open and reads everyone else's; a row not refreshed for ~20 seconds is
-- someone who has gone. Not a story table, so it doesn't bump edited_at.

create table if not exists story_presence (
  story_id uuid not null references stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null default '',
  scene_id uuid,
  seen_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table story_presence enable row level security;

drop policy if exists story_presence_select on story_presence;
create policy story_presence_select on story_presence for select to authenticated
  using (public.delve_role(story_id) is not null);

create or replace function public.set_presence(p_story uuid, p_scene uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(p_story) is null then return; end if;
  insert into story_presence (story_id, user_id, email, scene_id, seen_at)
  values (p_story, auth.uid(), coalesce(auth.jwt() ->> 'email', ''), p_scene, now())
  on conflict (story_id, user_id) do update
    set scene_id = excluded.scene_id, email = excluded.email, seen_at = now();
end $$;

revoke all on function public.set_presence(uuid, uuid) from public;
grant execute on function public.set_presence(uuid, uuid) to authenticated;
