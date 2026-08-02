-- Row Level Security for The Delve. Spec §9: owner | writer | voice | viewer.
--
-- Every table gets RLS from the migration that creates it — no table ships open.
--
-- The role lookup is SECURITY DEFINER on purpose. memberships has its own RLS,
-- and a policy on memberships that queried memberships would recurse forever.
-- A definer function bypasses RLS for that one lookup and breaks the cycle.

create or replace function public.delve_role(p_story_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role::text
  from public.memberships
  where story_id = p_story_id
    and user_id = auth.uid()
  limit 1
$$;

revoke all on function public.delve_role(uuid) from public;
grant execute on function public.delve_role(uuid) to authenticated;

-- Can the caller restructure the story? (Everything except audio.)
create or replace function public.delve_can_write(p_story_id uuid)
returns boolean
language sql
stable
as $$
  select public.delve_role(p_story_id) in ('owner', 'writer')
$$;

revoke all on function public.delve_can_write(uuid) from public;
grant execute on function public.delve_can_write(uuid) to authenticated;

alter table stories enable row level security;
alter table memberships enable row level security;
alter table nodes enable row level security;
alter table choices enable row level security;
alter table state_vars enable row level security;
alter table effects enable row level security;
alter table gates enable row level security;

-- ---------------------------------------------------------------- stories

create policy stories_select on stories for select to authenticated
  using (public.delve_role(id) is not null);

-- You may only create a story you own. The seed_owner_membership trigger then
-- makes you a member, so the select policy above starts matching.
create policy stories_insert on stories for insert to authenticated
  with check (owner_id = auth.uid());

create policy stories_update on stories for update to authenticated
  using (public.delve_role(id) = 'owner')
  with check (public.delve_role(id) = 'owner');

create policy stories_delete on stories for delete to authenticated
  using (public.delve_role(id) = 'owner');

-- ---------------------------------------------------------------- memberships

-- You can see your own membership, and members can see who else is on a story
-- (F9.5's "Dan is in this room" banner needs the roster).
create policy memberships_select on memberships for select to authenticated
  using (user_id = auth.uid() or public.delve_role(story_id) is not null);

create policy memberships_insert on memberships for insert to authenticated
  with check (public.delve_role(story_id) = 'owner');

create policy memberships_update on memberships for update to authenticated
  using (public.delve_role(story_id) = 'owner')
  with check (public.delve_role(story_id) = 'owner');

create policy memberships_delete on memberships for delete to authenticated
  using (public.delve_role(story_id) = 'owner');

-- ---------------------------------------------------------------- nodes

create policy nodes_select on nodes for select to authenticated
  using (public.delve_role(story_id) is not null);

create policy nodes_insert on nodes for insert to authenticated
  with check (public.delve_can_write(story_id));

-- voice is included here so it can record; the column restriction is enforced
-- by the trigger below, because RLS cannot scope an UPDATE to specific columns.
create policy nodes_update on nodes for update to authenticated
  using (public.delve_role(story_id) in ('owner', 'writer', 'voice'))
  with check (public.delve_role(story_id) in ('owner', 'writer', 'voice'));

create policy nodes_delete on nodes for delete to authenticated
  using (public.delve_can_write(story_id));

-- §9: "voice can only update audio_path and status". Anything else it touches
-- is rejected outright rather than silently ignored.
create or replace function restrict_voice_node_updates() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.slug is distinct from old.slug
       or new.title is distinct from old.title
       or new.narration is distinct from old.narration
       or new.node_type is distinct from old.node_type
       or new.notes is distinct from old.notes
       or new.timeout_target_id is distinct from old.timeout_target_id
       or new.invalid_target_id is distinct from old.invalid_target_id
       or new.timeout_seconds is distinct from old.timeout_seconds
    then
      raise exception
        'the voice role may only update audio_path, audio_duration_ms and status';
    end if;
  end if;
  return new;
end $$;

create trigger nodes_voice_guard
  before update on nodes
  for each row execute function restrict_voice_node_updates();

-- ------------------------------------------- choices / state_vars / effects / gates
--
-- Uniform: any member reads, only owner and writer mutate. voice has no
-- business restructuring the graph.

create policy choices_select on choices for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy choices_write on choices for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy state_vars_select on state_vars for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy state_vars_write on state_vars for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy effects_select on effects for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy effects_write on effects for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy gates_select on gates for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy gates_write on gates for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

-- ---------------------------------------------------------------- grants

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  stories, memberships, nodes, choices, state_vars, effects, gates
  to authenticated;

-- anon gets nothing. The Delve is an authoring tool; there is no public read
-- path until F9.7's share links, which will land as their own migration.
