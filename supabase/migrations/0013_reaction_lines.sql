-- A reaction can be a conversation too.
--
-- Room narration splits into attributed lines so two separately-booked actors
-- can share a scene. A door's reaction is the same kind of writing — "CARTER:
-- don't touch it. / MIKE: too late." happens in the doorway as readily as in a
-- room — and it had no way to say who was speaking.
--
-- So a line hangs off either a node or a choice. The same shape as `effects`
-- (§2's spec gap): two nullable foreign keys and a CHECK, rather than a
-- polymorphic owner_type/owner_id, which buys referential integrity and
-- cascade deletes that actually work.

alter table dialogue_lines
  alter column node_id drop not null;

alter table dialogue_lines
  add column choice_id uuid references choices (id) on delete cascade;

alter table dialogue_lines
  add constraint dialogue_lines_one_owner
  check (num_nonnulls(node_id, choice_id) = 1);

create index dialogue_lines_choice_idx on dialogue_lines (choice_id);

-- The denormalised story_id now has two places to come from. Same reason as
-- before: RLS runs on every row of every query, so it stays a single indexed
-- lookup rather than a join.
create or replace function enforce_dialogue_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.node_id is not null then
    select story_id into new.story_id from nodes where id = new.node_id;
  else
    select story_id into new.story_id from choices where id = new.choice_id;
  end if;
  if new.character_id is not null
     and (select story_id from characters where id = new.character_id) <> new.story_id then
    raise exception 'a line cannot be spoken by a character from another story';
  end if;
  return new;
end $$;
