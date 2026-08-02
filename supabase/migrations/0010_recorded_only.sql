-- Nothing in the exported flow is spoken by Twilio.
--
-- The exporter used to fall back to a Say widget wherever audio was missing, so
-- an unfinished room came out of the phone in a text-to-speech voice sitting
-- next to real performances. That is worse than silence: it ships, it sounds
-- broken, and it hides which rooms still need a session. Unrecorded lines are
-- now simply not emitted, and the export says exactly what is missing.
--
-- Which means everything the caller hears needs somewhere to put a file. Two
-- things were still text-only:
--
--   * A FIGHT ROUND's narration — "Rising Tiger Shark! The shark punches" is a
--     performance, and mid-fight is the last place a robot voice belongs.
--   * A GATE's refusal — "the door won't budge" is read aloud like anything
--     else.
--
-- Both get an audio slot, and both become recordable by the `voice` role under
-- the same rule as everywhere else: an actor records, they do not rewrite.

alter table fight_rounds
  add column audio_path text,
  add column audio_duration_ms int;

alter table gates
  add column fail_audio_path text,
  add column fail_audio_duration_ms int;

-- ------------------------------------------------------------ voice access

create policy fight_rounds_voice_update on fight_rounds for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

create policy gates_voice_update on gates for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

-- §9's rule again. A trigger rather than a policy for the reason it always is:
-- RLS cannot scope an UPDATE to specific columns.
create or replace function restrict_voice_round_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.fight_id is distinct from old.fight_id
       or new.sort_order is distinct from old.sort_order
       or new.opponent_move is distinct from old.opponent_move
       or new.narration is distinct from old.narration
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger fight_rounds_voice_guard
  before update on fight_rounds
  for each row execute function restrict_voice_round_updates();

create or replace function restrict_voice_gate_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.choice_id is distinct from old.choice_id
       or new.expression is distinct from old.expression
       or new.fail_behavior is distinct from old.fail_behavior
       or new.fail_narration is distinct from old.fail_narration
       or new.fail_node_id is distinct from old.fail_node_id
       or new.consume_on_pass is distinct from old.consume_on_pass
    then
      raise exception 'the voice role may only update fail_audio_path and fail_audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger gates_voice_guard
  before update on gates
  for each row execute function restrict_voice_gate_updates();

revoke all on function public.restrict_voice_round_updates() from public, anon, authenticated;
revoke all on function public.restrict_voice_gate_updates() from public, anon, authenticated;
