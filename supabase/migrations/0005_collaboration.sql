-- Collaboration (spec §9).
--
-- F9.4 is the one that matters: with a group, the ledger stops being a to-do
-- list and becomes a work queue. Claiming an unexplored passage greys it out in
-- everyone else's app — the difference between three people collaborating and
-- three people colliding.
--
-- Deliberately NOT doing full real-time co-editing. §9 is explicit that
-- last-write-wins plus soft locks is enough for a group this size, and
-- operational transforms are a large build for a small payoff here.

-- ---------------------------------------------------------------- comments

create table node_comments (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  node_id uuid not null references nodes (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index node_comments_node_idx on node_comments (node_id, created_at);
create index node_comments_story_idx on node_comments (story_id);

-- ---------------------------------------------------------------- claims
--
-- A claim can hang off either a node (a dark room to record) or a choice (an
-- unwritten branch to write) — the two things the ledger lists as work. Same
-- CHECK-one-owner shape as `effects`, for the same reason.

create table claims (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references stories (id) on delete cascade,
  node_id uuid references nodes (id) on delete cascade,
  choice_id uuid references choices (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  constraint claims_one_owner check (
    (node_id is not null and choice_id is null)
    or (node_id is null and choice_id is not null)
  )
);

-- One claim per piece of work. Two people cannot claim the same room, which is
-- the entire point of the feature.
create unique index claims_node_unique on claims (node_id) where node_id is not null;
create unique index claims_choice_unique on claims (choice_id) where choice_id is not null;
create index claims_user_idx on claims (user_id);

-- ---------------------------------------------------------------- RLS

alter table node_comments enable row level security;
alter table claims enable row level security;

create policy node_comments_select on node_comments for select to authenticated
  using (public.delve_role(story_id) is not null);

-- Anyone on the story may comment, including `voice` and `viewer`: leaving a
-- note is not restructuring the story, and a voice actor flagging a line that
-- won't read aloud is exactly what comments are for.
create policy node_comments_insert on node_comments for insert to authenticated
  with check (
    public.delve_role(story_id) is not null
    and author_id = auth.uid()
  );

-- You may edit or delete your own comment; an owner may clear any of them.
create policy node_comments_update on node_comments for update to authenticated
  using (author_id = auth.uid() or public.delve_role(story_id) = 'owner')
  with check (author_id = auth.uid() or public.delve_role(story_id) = 'owner');

create policy node_comments_delete on node_comments for delete to authenticated
  using (author_id = auth.uid() or public.delve_role(story_id) = 'owner');

create policy claims_select on claims for select to authenticated
  using (public.delve_role(story_id) is not null);

create policy claims_insert on claims for insert to authenticated
  with check (
    public.delve_role(story_id) in ('owner', 'writer', 'voice')
    and user_id = auth.uid()
  );

-- Release your own claim; an owner can release a claim someone left behind.
create policy claims_delete on claims for delete to authenticated
  using (user_id = auth.uid() or public.delve_role(story_id) = 'owner');

grant select, insert, update, delete on node_comments, claims to authenticated;

-- F9.5's "Dan is in this room" banner rides on Realtime presence, which needs
-- no table — presence is ephemeral and belongs in the channel, not in Postgres.
