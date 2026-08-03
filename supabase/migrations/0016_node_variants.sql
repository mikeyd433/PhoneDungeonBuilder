-- A room that reads differently depending on what you are carrying.
--
-- Until now, state could change which DOORS a room offers — a gate set to
-- `hide` removes one — but never what the room SAYS. So the one thing the
-- caller actually hears was the same on the first visit and the fifth, with the
-- lamp and without it. Authors worked around it by building two rooms and
-- diverting between them, which duplicates the doors, the effects and the
-- recording, and drifts apart the moment either copy is edited.
--
-- A variant is one alternate reading of a room: a condition, a script, and a
-- take. They are tried in order and the FIRST whose condition passes is what
-- plays; if none do, the room's own narration plays, exactly as it does today.
-- That "otherwise" is the room itself rather than a fourth variant, so adding
-- this to a story changes nothing about any room that has none.
--
-- It also closes a hole in `hide`. A hidden door works on the phone but nothing
-- announces it, because a recorded room cannot carry a Liquid conditional —
-- the exporter has been warning about exactly this. With a variant, the reading
-- that mentions the door IS the version that plays when the caller can take it.
--
-- ONE TAKE PER VARIANT, deliberately. A room's base narration can split into
-- attributed lines for two separately-booked actors; a variant cannot. Making
-- it splittable means hanging dialogue_lines off a third owner, and half of
-- that shipped is worse than none of it. A variant is an alternate reading, so
-- it is recorded the way an alternate reading is: once, by one person.
--
-- NO EFFECTS ON A VARIANT either. Which reading plays depends on state; if it
-- could also CHANGE state, the room would grant different things on different
-- visits and the solver would have to explore that. Conditional effects are a
-- different feature, and this one does not quietly become it.

create table node_variants (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  node_id uuid not null references nodes (id) on delete cascade,
  /* Same boolean tree the gates use, built by the same builder, evaluated by
     the same code. A variant asking a question a gate cannot ask would be a
     second expression language to keep honest. */
  expression jsonb not null default '{"op":"and","args":[]}'::jsonb,
  narration text not null default '',
  audio_path text,
  audio_duration_ms int,
  /* First match wins, so the order is the author's if/elsif chain and not a
     detail. Ties break on created_at. */
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index node_variants_node_idx on node_variants (node_id, sort_order);
create index node_variants_story_idx on node_variants (story_id);

comment on table node_variants is
  'Alternate readings of a room, tried in sort_order. First passing expression wins; none passing means the room''s own narration plays.';

-- ------------------------------------------------------------ story_id guard

-- Same reason as everywhere else: story_id is denormalised so RLS is one
-- indexed lookup instead of a join, and a trigger is what keeps it honest
-- rather than trust in the client.
create or replace function enforce_variant_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select story_id into new.story_id from nodes where id = new.node_id;
  return new;
end $$;

create trigger node_variants_story_guard
  before insert or update on node_variants
  for each row execute function enforce_variant_story();

create trigger node_variants_touch before update on node_variants
  for each row execute function touch_updated_at();

-- ------------------------------------------------------------ RLS

alter table node_variants enable row level security;

create policy node_variants_select on node_variants for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy node_variants_write on node_variants for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

-- A variant is a recordable slot, so the voice role has to be able to point one
-- at a file — and only at a file. §9's rule, and a trigger for the reason it
-- always is: a row-level policy cannot scope an UPDATE to specific columns.
create policy node_variants_voice_update on node_variants for update to authenticated
  using (public.delve_role(story_id) = 'voice')
  with check (public.delve_role(story_id) = 'voice');

create or replace function restrict_voice_variant_updates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(new.story_id) = 'voice' then
    if new.story_id is distinct from old.story_id
       or new.node_id is distinct from old.node_id
       or new.expression is distinct from old.expression
       or new.narration is distinct from old.narration
       or new.sort_order is distinct from old.sort_order
    then
      raise exception 'the voice role may only update audio_path and audio_duration_ms';
    end if;
  end if;
  return new;
end $$;

create trigger node_variants_voice_guard
  before update on node_variants
  for each row execute function restrict_voice_variant_updates();

grant select, insert, update, delete on node_variants to authenticated;

revoke all on function public.enforce_variant_story() from public, anon, authenticated;
revoke all on function public.restrict_voice_variant_updates() from public, anon, authenticated;
