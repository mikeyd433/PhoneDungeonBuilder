-- The check that happens on the way IN, not on the way out.
--
-- A gate hangs off a choice, so "if they have the rope, this goes differently"
-- had to be written on every door leading into the room — three doors meant
-- three copies drifting apart. And a gate can only refuse, hide or divert the
-- door it is on; it cannot say "arriving here with the rope is a different
-- scene entirely", which is the shape a story with two outcomes actually has.
--
-- So a reading gets a destination. On arrival the chain is evaluated in order,
-- and the first match decides:
--
--   words, no destination   — the room, read differently. (0016.)
--   words and a destination — hear this, then go there.
--   destination, no words   — go straight there, no pause.
--   neither                 — the room as written, which is the default.
--
-- The destination is where DIALOGUE OPTIONS diverge. A variant is one take, so
-- it cannot split between two actors — but the room it sends the caller to is
-- an ordinary room with its own cast, its own split script and its own doors.
-- Two outcomes with different conversations and different exits are two rooms
-- and one check, which is also how they get recorded and how they get read on
-- the map.
--
-- ON DELETE SET NULL, not CASCADE: deleting the room a reading points at must
-- leave the reading behind saying so, not silently remove the check. The ledger
-- reports a reading with no destination the same way it reports any other
-- unwritten branch.

alter table node_variants
  add column goto_node_id uuid references nodes (id) on delete set null;

comment on column node_variants.goto_node_id is
  'Where a caller this reading applies to ends up. Null means they stay in this room and are offered its doors.';

create index node_variants_goto_idx on node_variants (goto_node_id);

-- The voice role records; it does not rewire. Same list as 0016, one longer.
create or replace function restrict_voice_variant_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.node_id is distinct from old.node_id
       or new.expression is distinct from old.expression
       or new.narration is distinct from old.narration
       or new.goto_node_id is distinct from old.goto_node_id
       or new.sort_order is distinct from old.sort_order
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;
