-- The Delve — initial schema. Mirrors spec §2 (data model) and §9 (collaboration).
--
-- Three deliberate deviations from the spec, all decided during spec review:
--
--   1. node_type has no `hub`. The spec listed it in the enum but never defined
--      what a hub does differently from a room, so it is cut. §2 says type
--      conversion should be free, so it can be added back later without pain.
--
--   2. nodes.timeout_seconds is new. F5.4 and §4.4 both enforce "the node's
--      timeout window" but §2's table had no column to hold it.
--
--   3. effects uses two nullable FKs (node_id / choice_id) with a CHECK that
--      exactly one is set, instead of §2's polymorphic owner_type + owner_id.
--      Same expressiveness, but it buys real referential integrity and
--      ON DELETE CASCADE, which a polymorphic owner_id cannot have. The app
--      layer still presents this as an owner_type discriminator.
--
-- story_id is denormalised onto choices/effects/gates. It is redundant against
-- the FK chain, but RLS runs on every row of every query and this turns a
-- three-table join into a single indexed lookup. Triggers keep it honest.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

create type node_type as enum ('room', 'ending');
create type node_status as enum ('stub', 'scripted', 'recorded', 'approved');
create type state_var_kind as enum ('item', 'flag', 'counter');
create type effect_operation as enum ('grant', 'revoke', 'set', 'add');
create type gate_fail_behavior as enum ('hide', 'refuse', 'divert');
create type membership_role as enum ('owner', 'writer', 'voice', 'viewer');

-- ---------------------------------------------------------------- stories

create table stories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  -- Nullable and FK-less at creation: nodes.story_id points back here, so the
  -- constraint is added after the nodes table exists.
  root_node_id uuid,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- §11.5 — the solver needs a ceiling per counter or the state space is
  -- infinite and it never terminates. §7 suggests 10.
  counter_clamp int not null default 10 check (counter_clamp between 1 and 100),
  -- §11.3 — `refuse` teaches the player the item exists; `hide` is cheaper in
  -- widgets. Changeable at any time.
  default_fail_behavior gate_fail_behavior not null default 'refuse',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- memberships

create table memberships (
  story_id uuid not null references stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role membership_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index memberships_user_idx on memberships (user_id);

-- ---------------------------------------------------------------- nodes

create table nodes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  slug text not null check (length(trim(slug)) > 0),
  title text not null default '',
  narration text not null default '',
  node_type node_type not null default 'room',
  audio_path text,
  audio_duration_ms int check (audio_duration_ms is null or audio_duration_ms >= 0),
  status node_status not null default 'stub',
  notes text,
  -- Where a silent caller goes. Null means "repeat this node" (§4.2 default).
  timeout_target_id uuid references nodes (id) on delete set null,
  -- Where a wrong keypress goes. Null means "repeat this node".
  invalid_target_id uuid references nodes (id) on delete set null,
  -- Spec gap: F5.4 / §4.4 enforce a per-node timeout window with no column for it.
  timeout_seconds int not null default 5 check (timeout_seconds between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, slug)
);

create index nodes_story_idx on nodes (story_id);
create index nodes_status_idx on nodes (story_id, status);

alter table stories
  add constraint stories_root_node_fk
  foreign key (root_node_id) references nodes (id) on delete set null;

-- ---------------------------------------------------------------- choices

create table choices (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  from_node_id uuid not null references nodes (id) on delete cascade,
  digit text not null check (digit in ('0','1','2','3','4','5','6','7','8','9','*','#')),
  label text not null default '',
  -- null = bricked archway, an unwritten branch (§2). This is the to-write list
  -- that feeds the ledger's "unexplored passages" tab.
  to_node_id uuid references nodes (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- No two choices on the same keypad digit (§2 constraints).
  unique (from_node_id, digit)
);

create index choices_from_idx on choices (from_node_id);
create index choices_to_idx on choices (to_node_id);
create index choices_story_idx on choices (story_id);

-- ---------------------------------------------------------------- state_vars

create table state_vars (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  slug text not null check (slug ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null default '',
  kind state_var_kind not null default 'item',
  description text,
  -- Auto-revoked when used to pass a gate (F8.9).
  is_consumable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (story_id, slug)
);

create index state_vars_story_idx on state_vars (story_id);

-- ---------------------------------------------------------------- effects

create table effects (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  -- Exactly one of these is set; see the CHECK below. A node effect fires on
  -- arrival, a choice effect fires when that digit is pressed (§2).
  node_id uuid references nodes (id) on delete cascade,
  choice_id uuid references choices (id) on delete cascade,
  state_var_id uuid not null references state_vars (id) on delete cascade,
  operation effect_operation not null,
  -- For `add` / `set` on counters.
  amount int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint effects_one_owner check (
    (node_id is not null and choice_id is null)
    or (node_id is null and choice_id is not null)
  ),
  -- grant/revoke are set operations and take no amount; set/add require one.
  constraint effects_amount_matches_operation check (
    (operation in ('grant', 'revoke') and amount is null)
    or (operation in ('set', 'add') and amount is not null)
  )
);

create index effects_node_idx on effects (node_id);
create index effects_choice_idx on effects (choice_id);
create index effects_var_idx on effects (state_var_id);
create index effects_story_idx on effects (story_id);

-- ---------------------------------------------------------------- gates

create table gates (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  -- One gate per choice (§2).
  choice_id uuid not null unique references choices (id) on delete cascade,
  -- Boolean tree, built in the UI, never typed by hand. Ops: has, lacks, and,
  -- or, not, gte, lte, eq. Validated in the app layer, not here — the shape is
  -- recursive and a CHECK constraint would be unreadable.
  expression jsonb not null default '{"op":"and","args":[]}'::jsonb,
  fail_behavior gate_fail_behavior not null default 'refuse',
  -- For `refuse` — "The gate won't budge."
  fail_narration text,
  -- For `divert`.
  fail_node_id uuid references nodes (id) on delete set null,
  consume_on_pass boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A divert gate without a destination is a dead end at export time.
  constraint gates_divert_needs_target check (
    fail_behavior <> 'divert' or fail_node_id is not null
  )
);

create index gates_story_idx on gates (story_id);

-- ---------------------------------------------------------------- integrity

-- Endings may not have choices (§2). The spec says enforce in app, not DB, so
-- types stay freely convertible — this is a warning surface in the UI, not a
-- constraint here. Intentionally not implemented as a trigger.

-- Keep the denormalised story_id honest: it must match the story of whatever
-- the row hangs off. Cheaper than trusting the client.
create or replace function enforce_choice_story() returns trigger
language plpgsql as $$
begin
  select story_id into new.story_id from nodes where id = new.from_node_id;
  if new.to_node_id is not null
     and (select story_id from nodes where id = new.to_node_id) <> new.story_id then
    raise exception 'choice cannot cross story boundaries';
  end if;
  return new;
end $$;

create trigger choices_story_guard
  before insert or update on choices
  for each row execute function enforce_choice_story();

create or replace function enforce_effect_story() returns trigger
language plpgsql as $$
begin
  if new.node_id is not null then
    select story_id into new.story_id from nodes where id = new.node_id;
  else
    select story_id into new.story_id from choices where id = new.choice_id;
  end if;
  if (select story_id from state_vars where id = new.state_var_id) <> new.story_id then
    raise exception 'effect cannot reference a state var from another story';
  end if;
  return new;
end $$;

create trigger effects_story_guard
  before insert or update on effects
  for each row execute function enforce_effect_story();

create or replace function enforce_gate_story() returns trigger
language plpgsql as $$
begin
  select story_id into new.story_id from choices where id = new.choice_id;
  return new;
end $$;

create trigger gates_story_guard
  before insert or update on gates
  for each row execute function enforce_gate_story();

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger stories_touch before update on stories
  for each row execute function touch_updated_at();
create trigger nodes_touch before update on nodes
  for each row execute function touch_updated_at();
create trigger choices_touch before update on choices
  for each row execute function touch_updated_at();
create trigger state_vars_touch before update on state_vars
  for each row execute function touch_updated_at();
create trigger gates_touch before update on gates
  for each row execute function touch_updated_at();

-- The story owner is a member from the moment the story exists, so permission
-- checks have exactly one code path.
create or replace function seed_owner_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into memberships (story_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end $$;

create trigger stories_seed_owner
  after insert on stories
  for each row execute function seed_owner_membership();
