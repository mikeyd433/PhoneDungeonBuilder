-- A door can answer back.
--
-- Everything recordable so far belongs to a place or to a fight: a room, a
-- line, a round, a refusal. Nothing belonged to the ACT of choosing. "You put
-- your shoulder to it and the glass goes everywhere" is not the room you left
-- and not the room you arrive in — it is the moment between, and writing it
-- into either one puts it in the wrong place. Into the room you left, and
-- every other door hears it too; into the room you arrive at, and it plays
-- again when you come back a second time by another route.
--
-- So a choice gets its own take, played after the keypress and before the next
-- room. Same rule as everything else: unrecorded is silence, never synthesised.
--
-- A gated door plays its reaction only when the gate PASSES — the refusal has
-- its own take already, and hearing the reaction to a thing you were not
-- allowed to do would be worse than hearing nothing.

alter table choices
  -- The script and the take, together, as everywhere else. A reaction nobody
  -- has recorded is still worth writing down: it is what the actor reads, and
  -- what the playtest speaks as a rehearsal aid.
  add column reaction_narration text,
  add column audio_path text,
  add column audio_duration_ms int;

-- ------------------------------------------------------------ voice access

create policy choices_voice_update on choices for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

-- §9's rule, and a trigger for the reason it always is: RLS cannot scope an
-- UPDATE to specific columns. An actor records; they do not rewire the dungeon.
create or replace function restrict_voice_choice_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.from_node_id is distinct from old.from_node_id
       or new.to_node_id is distinct from old.to_node_id
       or new.digit is distinct from old.digit
       or new.label is distinct from old.label
       or new.reaction_narration is distinct from old.reaction_narration
       or new.sort_order is distinct from old.sort_order
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger choices_voice_guard
  before update on choices
  for each row execute function restrict_voice_choice_updates();
