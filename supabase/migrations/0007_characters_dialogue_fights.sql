-- Characters, dialogue lines, and fights.
--
-- Three additions, decided together:
--
--  1. `characters` — a cast list. Every speaker in the story, each with the
--     voice actor who records them. Drives the per-actor record queue and the
--     printable script. Has no effect on the compiled Twilio flow.
--
--  2. `dialogue_lines` — a room's narration split into ordered, attributed
--     lines. AUDIO STAYS ON THE NODE: a room is still recorded as one file, so
--     the widget count and the recording workflow are untouched. Lines exist so
--     the script can be grouped by who speaks and the room can show who is
--     talking.
--
--  3. `fights` — a first-class kind of room. A fight is not a room with exits;
--     it is a scripted exchange where the opponent announces a move each round
--     and the caller must answer with the move that counters it. This is the
--     shape the shark fight was hand-built in: nine Punch/Kick/Block nodes
--     wired so a wrong answer kills you and a right one advances.
--
-- `fight` is NOT added to the node_type enum. Postgres cannot add an enum value
-- and use it in the same transaction, and a fight is better modelled as a row
-- hanging off a node anyway: a node either has a fight or it doesn't, and
-- deleting the fight leaves an ordinary room behind.

-- ---------------------------------------------------------------- characters

create table characters (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  slug text not null check (slug ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null check (length(trim(name)) > 0),
  -- `playable` marks a character the caller can be. The rest are the cast.
  is_playable boolean not null default false,
  /* Who records this character. Free text rather than a user reference: a voice
     actor is usually not a member of the story, and often not a user at all. */
  voice_actor text,
  /* One of the §3 palette names, so a speaker reads consistently everywhere. */
  color text not null default 'parchment',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, slug)
);

create index characters_story_idx on characters (story_id);

-- ---------------------------------------------------------------- dialogue

create table dialogue_lines (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  node_id uuid not null references nodes (id) on delete cascade,
  /* Null means unattributed — stage direction, sound effects, or narration with
     nobody speaking it. Deleting a character must not delete their lines, so
     this is SET NULL rather than CASCADE: losing a cast entry should orphan the
     attribution, never the words. */
  character_id uuid references characters (id) on delete set null,
  text text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dialogue_lines_node_idx on dialogue_lines (node_id, sort_order);
create index dialogue_lines_story_idx on dialogue_lines (story_id);
create index dialogue_lines_character_idx on dialogue_lines (character_id);

-- ---------------------------------------------------------------- fights

create table fights (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  /* One fight per room. The room's narration still plays first, as the
     lead-in. */
  node_id uuid not null unique references nodes (id) on delete cascade,
  opponent_name text not null default 'The opponent',
  /* Where the caller lands after the last round is answered correctly. */
  win_node_id uuid references nodes (id) on delete set null,
  /* Where a wrong answer sends them. Null means the fight is unfinished. */
  lose_node_id uuid references nodes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fights_story_idx on fights (story_id);

-- The moves available in one fight, and what each one counters.
create table fight_moves (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  fight_id uuid not null references fights (id) on delete cascade,
  slug text not null check (slug ~ '^[A-Z][A-Z0-9_]*$'),
  label text not null default '',
  /* The opponent move this one defeats. Null while the author is still
     deciding, which the validator reports rather than the database refusing. */
  beats text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (fight_id, slug)
);

create index fight_moves_fight_idx on fight_moves (fight_id, sort_order);

-- One round: the opponent announces a move, the caller must counter it.
create table fight_rounds (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  fight_id uuid not null references fights (id) on delete cascade,
  sort_order int not null default 0,
  /* Matches fight_moves.beats. Free text rather than an FK so a round can be
     written before its move exists. */
  opponent_move text not null default '',
  /* What the caller hears: "Rising Tiger Shark! The shark punches." */
  narration text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fight_rounds_fight_idx on fight_rounds (fight_id, sort_order);

-- ---------------------------------------------------------------- integrity

-- Same denormalised story_id trick as choices/effects/gates: RLS runs on every
-- row of every query, so keep it a single indexed lookup rather than a join.
create or replace function enforce_dialogue_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select story_id into new.story_id from nodes where id = new.node_id;
  if new.character_id is not null
     and (select story_id from characters where id = new.character_id) <> new.story_id then
    raise exception 'a line cannot be spoken by a character from another story';
  end if;
  return new;
end $$;

create trigger dialogue_lines_story_guard
  before insert or update on dialogue_lines
  for each row execute function enforce_dialogue_story();

create or replace function enforce_fight_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select story_id into new.story_id from nodes where id = new.node_id;
  return new;
end $$;

create trigger fights_story_guard
  before insert or update on fights
  for each row execute function enforce_fight_story();

create or replace function enforce_fight_child_story() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select story_id into new.story_id from fights where id = new.fight_id;
  return new;
end $$;

create trigger fight_moves_story_guard
  before insert or update on fight_moves
  for each row execute function enforce_fight_child_story();

create trigger fight_rounds_story_guard
  before insert or update on fight_rounds
  for each row execute function enforce_fight_child_story();

create trigger characters_touch before update on characters
  for each row execute function touch_updated_at();
create trigger dialogue_lines_touch before update on dialogue_lines
  for each row execute function touch_updated_at();
create trigger fights_touch before update on fights
  for each row execute function touch_updated_at();
create trigger fight_rounds_touch before update on fight_rounds
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- RLS

alter table characters enable row level security;
alter table dialogue_lines enable row level security;
alter table fights enable row level security;
alter table fight_moves enable row level security;
alter table fight_rounds enable row level security;

create policy characters_select on characters for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy characters_write on characters for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy dialogue_lines_select on dialogue_lines for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy dialogue_lines_write on dialogue_lines for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy fights_select on fights for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy fights_write on fights for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy fight_moves_select on fight_moves for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy fight_moves_write on fight_moves for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

create policy fight_rounds_select on fight_rounds for select to authenticated
  using (public.delve_role(story_id) is not null);
create policy fight_rounds_write on fight_rounds for all to authenticated
  using (public.delve_can_write(story_id))
  with check (public.delve_can_write(story_id));

grant select, insert, update, delete on
  characters, dialogue_lines, fights, fight_moves, fight_rounds
  to authenticated;

revoke all on function public.enforce_dialogue_story() from public, anon, authenticated;
revoke all on function public.enforce_fight_story() from public, anon, authenticated;
revoke all on function public.enforce_fight_child_story() from public, anon, authenticated;
