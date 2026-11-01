-- The phone app syncs whole stories with these tables (android/engine/.../sync).
--
-- 1. Columns the phone already keeps, so nothing is lost on the way through:
--    a scene's chapter (its lane on the flowchart), how far a box or a lane was
--    moved by hand, and the arrangement saved as the default. All optional;
--    the web app can ignore them.
--
-- 2. stories.edited_at: the last time ANYTHING in the story changed, from
--    either app — a scene, a choice, a take, a delete. Sync compares it with
--    the phone's own edit time ("newest edit wins"), and needs it to see
--    deletes, which leave no updated_at behind. Bumped by statement-level
--    triggers on every table that carries story_id. SECURITY DEFINER because a
--    writer or voice member may edit a scene but not update the stories row
--    (stories_update is owner-only).

alter table nodes add column if not exists chapter text;
alter table nodes add column if not exists nudge_x real not null default 0;
alter table nodes add column if not exists nudge_y real not null default 0;

alter table stories add column if not exists lane_nudges jsonb not null default '{}'::jsonb;
alter table stories add column if not exists layout_home jsonb not null default '{}'::jsonb;
alter table stories add column if not exists edited_at timestamptz not null default now();

update stories s set edited_at = greatest(
  s.updated_at,
  coalesce((select max(updated_at) from nodes where story_id = s.id), s.updated_at),
  coalesce((select max(updated_at) from choices where story_id = s.id), s.updated_at)
);

create or replace function public.bump_story_edited_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update stories set edited_at = now() where id in (select distinct story_id from new_rows);
  return null;
end $$;

create or replace function public.bump_story_edited_old() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update stories set edited_at = now() where id in (select distinct story_id from old_rows);
  return null;
end $$;

revoke all on function public.bump_story_edited_new() from public;
revoke all on function public.bump_story_edited_old() from public;

do $$
declare t text;
begin
  foreach t in array array['nodes', 'choices', 'state_vars', 'effects', 'gates', 'characters',
                           'dialogue_lines', 'fights', 'fight_moves', 'fight_rounds', 'fight_round_outcomes']
  loop
    execute format('drop trigger if exists %I on %I', t || '_edited_ins', t);
    execute format('drop trigger if exists %I on %I', t || '_edited_upd', t);
    execute format('drop trigger if exists %I on %I', t || '_edited_del', t);
    execute format('create trigger %I after insert on %I referencing new table as new_rows for each statement execute function public.bump_story_edited_new()', t || '_edited_ins', t);
    execute format('create trigger %I after update on %I referencing new table as new_rows for each statement execute function public.bump_story_edited_new()', t || '_edited_upd', t);
    execute format('create trigger %I after delete on %I referencing old table as old_rows for each statement execute function public.bump_story_edited_old()', t || '_edited_del', t);
  end loop;
end $$;

-- The stories row itself: any change but the bump marks it edited.
create or replace function public.touch_story_edited() returns trigger
language plpgsql as $$
begin
  new.edited_at = now();
  return new;
end $$;

drop trigger if exists stories_edited on stories;
create trigger stories_edited before update on stories
  for each row execute function public.touch_story_edited();
