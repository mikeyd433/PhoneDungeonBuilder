-- Two corrections, from watching how the story is actually written.
--
-- 1. SILENCE SHOULD NOT KILL YOU ON THE FIRST BEAT.
--
--    A fight round used to send silence straight to the losing room. On a phone
--    that is far too sharp: callers hesitate, mishear, or are still working out
--    which digit is which. The round now repeats a few times before the fight
--    is called, which is what a person expects and what §6.3's patience valve
--    was already describing for gates.
--
--    Capped at 8 because Studio ends an execution when the same widget runs ten
--    times in a row (§6.0). Repeating past that point doesn't give the caller
--    more patience, it hangs up on them.
--
-- 2. A CONVERSATION IS NOT ALWAYS ONE RECORDING.
--
--    Dialogue lines were script-only: the room stayed one audio file, and the
--    cast list only decided who to book. That works when everyone in a scene
--    records together. It does not work when two characters are voiced by two
--    people in two sessions — and a conversation between them is exactly the
--    case the cast list exists for.
--
--    So a line can now carry its own recording. A room with line audio plays
--    its lines in order and then offers its exits, which is the shape a
--    dialogue-as-rooms chain was hand-built in, without a room per line. A room
--    with no line audio is unchanged: one file, as before.

alter table fights
  add column silence_patience int not null default 3
    check (silence_patience between 1 and 8);

comment on column fights.silence_patience is
  'How many times a round repeats on silence before the fight is called.';

alter table dialogue_lines
  add column audio_path text,
  add column audio_duration_ms int;

-- The voice role has to be able to record a line, the same way it records a
-- room. Its write policy is separate from the writer policy so the column
-- restriction below has something to hang off.
create policy dialogue_lines_voice_update on dialogue_lines for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

-- §9's rule, applied to lines: a voice actor records, they do not rewrite.
-- Same shape as restrict_voice_node_updates, and same reason it is a trigger —
-- a row-level policy cannot scope an UPDATE to specific columns.
create or replace function restrict_voice_line_updates() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.node_id is distinct from old.node_id
       or new.character_id is distinct from old.character_id
       or new.text is distinct from old.text
       or new.sort_order is distinct from old.sort_order
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger dialogue_lines_voice_guard
  before update on dialogue_lines
  for each row execute function restrict_voice_line_updates();

revoke all on function public.restrict_voice_line_updates() from public, anon, authenticated;
