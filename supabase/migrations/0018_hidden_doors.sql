-- Which doors the arrival check leaves standing.
--
-- A reading already decides what the room SAYS and where the caller ends up.
-- It could not decide what the room OFFERS, which left the two halves of one
-- decision in two places: the words came from the reading, the doors from a
-- `hide` gate written separately on each door. Two rules about the same item,
-- edited apart, disagreeing eventually.
--
-- It also left `hide` with a hole the exporter has been warning about for
-- months. A hidden door still works — the gather accepts the digit — but a
-- recorded room cannot carry a Liquid conditional, so nothing announces it and
-- the caller has to already know. A reading has no such problem: the version of
-- the narration that mentions the grate IS the version that plays when the
-- grate is there. Deciding both from one check closes it.
--
-- STORED AS WHAT IS HIDDEN, NOT WHAT IS OFFERED, and that polarity is the whole
-- design:
--
--   * no rows       -> every door, under every reading. Today's behaviour, so
--                      adding this changes nothing anywhere.
--   * a new door    -> appears under every reading until somebody says otherwise.
--   * a new reading -> offers every door until somebody says otherwise.
--
-- An "offered" list would have got both of those backwards: a door added next
-- month would be invisible in every reading written today, and nothing would
-- say why.
--
-- `variant_id` null means the room as written — the reading that plays when
-- none of the others match. That is a real slot an author needs to hide doors
-- in ("the grate is only there if you have the lamp" is a row against the
-- BASE), so it is a nullable FK rather than a fourth table.

create table hidden_doors (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  choice_id uuid not null references choices (id) on delete cascade,
  /* Null = the room as written. Cascades, so deleting a reading takes its
     visibility rules with it and never leaves a door hidden by a rule that no
     longer exists. */
  variant_id uuid references node_variants (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per pair, and Postgres does not treat NULLs as equal, so the base
-- slot needs a partial index of its own.
create unique index hidden_doors_pair_idx
  on hidden_doors (choice_id, variant_id) where variant_id is not null;
create unique index hidden_doors_base_idx
  on hidden_doors (choice_id) where variant_id is null;

create index hidden_doors_story_idx on hidden_doors (story_id);
create index hidden_doors_variant_idx on hidden_doors (variant_id);

-- ------------------------------------------------------------ story_id guard

create or replace function enforce_hidden_door_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select story_id into new.story_id from choices where id = new.choice_id;
  return new;
end $$;

create trigger hidden_doors_story_guard
  before insert or update on hidden_doors
  for each row execute function enforce_hidden_door_story();

-- ------------------------------------------------------------ RLS

alter table hidden_doors enable row level security;

create policy hidden_doors_select on hidden_doors for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy hidden_doors_write on hidden_doors for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

-- No voice-role policy on purpose: there is nothing here to record. An actor
-- has no business deciding which doors a caller is offered.

grant select, insert, update, delete on hidden_doors to authenticated;

revoke all on function public.enforce_hidden_door_story() from public, anon, authenticated;
