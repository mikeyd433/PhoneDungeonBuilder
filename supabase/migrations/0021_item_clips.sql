-- What is heard when an item changes hands.
--
-- `state_vars.audio_path` is a take of the item's NAME, and it exists for one
-- job: the inventory readback reciting what the caller is holding. It says
-- nothing at the moment the item is picked up or spent, and those moments are
-- the ones a story actually notices — "the rope is heavier than it looked",
-- "the last of the tape".
--
-- ON THE ITEM rather than on the effect, deliberately. A door already has a
-- REACTION for what is heard at that particular threshold ("Mike hands over
-- the helmet"), and that is the right place for words about this door. What
-- belongs to the item is what is true wherever it changes hands, so it is
-- written once and heard at every grant.
--
-- Script and take, like everything else here: unrecorded is silence on the
-- phone, and the export says so rather than reading it in a robot voice.
alter table public.state_vars
  add column if not exists gain_narration text,
  add column if not exists gain_audio_path text,
  add column if not exists gain_audio_duration_ms integer,
  add column if not exists spend_narration text,
  add column if not exists spend_audio_path text,
  add column if not exists spend_audio_duration_ms integer;

comment on column public.state_vars.gain_narration is
  'Heard when this item is granted, wherever that happens.';
comment on column public.state_vars.spend_narration is
  'Heard when this item is used up or taken away, wherever that happens.';

-- The `voice` role may set a take and nothing else. 0011 restricts the columns
-- an UPDATE may touch with a trigger, because a row-level policy cannot; the
-- two new SCRIPT columns have to join that list, or an actor could rewrite the
-- words they were booked to read.
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
       or new.gain_narration is distinct from old.gain_narration
       or new.spend_narration is distinct from old.spend_narration
    then
      raise exception 'the voice role may only update audio paths and durations';
    end if;
  end if;
  return new;
end $$;
