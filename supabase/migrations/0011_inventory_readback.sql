-- "What am I carrying?", asked from the phone.
--
-- The playtest has shown a live inventory since F5.3, but the caller never
-- could. This adds a reserved key — press it in any room, hear what you hold,
-- and land back in the room you were standing in.
--
-- It has to be recorded, like everything else the caller hears: §0's rule is
-- that nothing in the exported flow is spoken by Twilio. So an item needs a
-- take of its own name ("a coil of rope"), and the readback needs a lead-in
-- ("you are carrying…") and something for empty hands. An item with no take is
-- silence and is reported, exactly as an unrecorded room is.

alter table state_vars
  add column audio_path text,
  add column audio_duration_ms int;

alter table stories
  -- Null means the story has no readback at all, which is the default: a story
  -- that never grants anything should not spend a key on it.
  add column inventory_key text,
  add column inventory_intro_audio_path text,
  add column inventory_intro_audio_duration_ms int,
  add column inventory_empty_audio_path text,
  add column inventory_empty_audio_duration_ms int;

-- One keypad key, and never a digit a room might use for a door. `*` and `#`
-- are the only two the exporter can reserve globally without stealing a branch
-- from every room in the story.
alter table stories
  add constraint stories_inventory_key_check
  check (inventory_key is null or inventory_key in ('*', '#'));

-- ------------------------------------------------------------ voice access

create policy state_vars_voice_update on state_vars for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

-- §9's rule again, and a trigger for the reason it always is: RLS cannot scope
-- an UPDATE to specific columns. An actor records; they do not rewrite.
create or replace function restrict_voice_state_var_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.slug is distinct from old.slug
       or new.name is distinct from old.name
       or new.kind is distinct from old.kind
       or new.description is distinct from old.description
       or new.is_consumable is distinct from old.is_consumable
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger state_vars_voice_guard
  before update on state_vars
  for each row execute function restrict_voice_state_var_updates();

-- The two readback takes live on the story, so the voice role needs to reach it
-- too — and must not be able to rename the story or move its entrance.
create policy stories_voice_update on stories for update to authenticated
  using (public.delve_role(id) = 'voice')
  with check (public.delve_role(id) = 'voice');

create or replace function restrict_voice_story_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.id) = 'voice' then
    if new.title is distinct from old.title
       or new.root_node_id is distinct from old.root_node_id
       or new.owner_id is distinct from old.owner_id
       or new.counter_clamp is distinct from old.counter_clamp
       or new.default_fail_behavior is distinct from old.default_fail_behavior
       or new.inventory_key is distinct from old.inventory_key
    then
      raise exception 'the voice role may only update the inventory readback audio';
    end if;
  end if;
  return new;
end $$;

create trigger stories_voice_guard
  before update on stories
  for each row execute function restrict_voice_story_updates();
