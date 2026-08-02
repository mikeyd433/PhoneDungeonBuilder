-- Per-move destinations for a fight round.
--
-- The first cut of fights assumed a round has exactly ONE right answer: the
-- move whose `beats` matches the announcement advances, and everything else
-- goes to the fight's single losing room. That is one shape a fight can take,
-- not the only one. A fight is functionally a room where you pick an exit, and
-- sometimes every option in a round leads to the same place — a beat that plays
-- out the same however the caller answers, or a round with three different
-- consequences rather than "right" and "wrong".
--
-- So a round's move now names where it goes. One row per (round, move):
--
--   * a row present     -> that move goes to that room
--   * a row with a null -> the author has written this branch but not wired it
--                          (a bricked archway; the validator reports it)
--   * no row at all     -> fall back to the counter rule, which is what keeps
--                          the three-move / three-round fight a two-column
--                          table rather than a nine-cell grid
--
-- The counter rule stays because it is genuinely the terse case, and because
-- several moves are now allowed to counter the same announcement — that is how
-- "all of these advance" is said without filling in every cell.

create table fight_round_outcomes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  fight_id uuid not null references fights (id) on delete cascade,
  round_id uuid not null references fight_rounds (id) on delete cascade,
  move_id uuid not null references fight_moves (id) on delete cascade,
  /* Null means written-but-unwired, exactly as choices.to_node_id does. */
  to_node_id uuid references nodes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, move_id)
);

create index fight_round_outcomes_fight_idx on fight_round_outcomes (fight_id);
create index fight_round_outcomes_round_idx on fight_round_outcomes (round_id);

-- story_id and fight_id both come from the round, so neither can be forged, and
-- a move from a different fight cannot be smuggled in alongside.
create or replace function enforce_fight_outcome() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  round_fight uuid;
  move_fight uuid;
begin
  select fight_id, story_id into round_fight, new.story_id
    from fight_rounds where id = new.round_id;
  select fight_id into move_fight from fight_moves where id = new.move_id;
  if round_fight is null or move_fight is null or round_fight <> move_fight then
    raise exception 'a round outcome must join a round and a move from the same fight';
  end if;
  new.fight_id := round_fight;
  return new;
end $$;

create trigger fight_round_outcomes_guard
  before insert or update on fight_round_outcomes
  for each row execute function enforce_fight_outcome();

create trigger fight_round_outcomes_touch before update on fight_round_outcomes
  for each row execute function touch_updated_at();

alter table fight_round_outcomes enable row level security;

create policy fight_round_outcomes_select on fight_round_outcomes for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy fight_round_outcomes_write on fight_round_outcomes for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

grant select, insert, update, delete on fight_round_outcomes to authenticated;

revoke all on function public.enforce_fight_outcome() from public, anon, authenticated;
