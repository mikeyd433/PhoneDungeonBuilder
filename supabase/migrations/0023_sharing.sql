-- Sharing a story from the phone (android: SHARE on a story).
--
-- memberships already gives every role its rights (0002), but there was no way
-- to add anyone: a client can't look a user up by email, and the person may not
-- have an account yet. So:
--
--   invite_to_story(story, email, role)  owner only. Adds the membership at once
--                                        if that email has an account; otherwise
--                                        leaves an invite waiting for it.
--   accept_story_invites()               turns every invite for the caller's email
--                                        into a membership. The phone calls it on
--                                        each sync, so signing in is accepting.
--   story_members(story)                 who is on a story, with emails (members
--                                        only; auth.users isn't readable otherwise).
--   remove_story_member(story, user)     owner only; never the owner themselves.
--   leave_story(story)                   a member who isn't the owner steps off.
--
-- SECURITY DEFINER because each needs auth.users or another member's row; each
-- checks the caller's role itself before doing anything.

create table if not exists story_invites (
  story_id uuid not null references stories (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  role membership_role not null default 'writer',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (story_id, email)
);

alter table story_invites enable row level security;

drop policy if exists story_invites_select on story_invites;
create policy story_invites_select on story_invites for select to authenticated
  using (public.delve_role(story_id) = 'owner' or email = lower(auth.jwt() ->> 'email'));

drop policy if exists story_invites_delete on story_invites;
create policy story_invites_delete on story_invites for delete to authenticated
  using (public.delve_role(story_id) = 'owner' or email = lower(auth.jwt() ->> 'email'));

create or replace function public.invite_to_story(p_story uuid, p_email text, p_role membership_role default 'writer')
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
begin
  if public.delve_role(p_story) is distinct from 'owner' then
    raise exception 'Only the story''s owner can share it.';
  end if;
  if p_role = 'owner' then
    raise exception 'A story has one owner.';
  end if;
  if position('@' in v_email) < 2 then
    raise exception 'That isn''t an email address.';
  end if;
  select id into v_user from auth.users where lower(email) = v_email limit 1;
  if v_user is not null then
    if v_user = auth.uid() then raise exception 'That''s you.'; end if;
    insert into memberships (story_id, user_id, role) values (p_story, v_user, p_role)
      on conflict (story_id, user_id) do update set role = excluded.role
      where memberships.role <> 'owner';
    return 'added';
  end if;
  insert into story_invites (story_id, email, role, invited_by) values (p_story, v_email, p_role, auth.uid())
    on conflict (story_id, email) do update set role = excluded.role;
  return 'invited';
end $$;

create or replace function public.accept_story_invites()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_count integer := 0;
begin
  if auth.uid() is null or v_email is null then return 0; end if;
  insert into memberships (story_id, user_id, role)
    select story_id, auth.uid(), role from story_invites where email = v_email
    on conflict (story_id, user_id) do nothing;
  get diagnostics v_count = row_count;
  delete from story_invites where email = v_email;
  return v_count;
end $$;

create or replace function public.story_members(p_story uuid)
returns table (user_id uuid, email text, role text, pending boolean)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.role::text, false
    from memberships m join auth.users u on u.id = m.user_id
   where m.story_id = p_story and public.delve_role(p_story) is not null
  union all
  select null, i.email, i.role::text, true
    from story_invites i
   where i.story_id = p_story and public.delve_role(p_story) = 'owner'
$$;

create or replace function public.remove_story_member(p_story uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(p_story) is distinct from 'owner' then
    raise exception 'Only the story''s owner can remove people.';
  end if;
  delete from memberships where story_id = p_story and user_id = p_user and role <> 'owner';
end $$;

create or replace function public.cancel_story_invite(p_story uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(p_story) is distinct from 'owner' then
    raise exception 'Only the story''s owner can cancel an invite.';
  end if;
  delete from story_invites where story_id = p_story and email = lower(trim(p_email));
end $$;

create or replace function public.leave_story(p_story uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.delve_role(p_story) = 'owner' then
    raise exception 'The owner can''t leave their own story. Delete it instead.';
  end if;
  delete from memberships where story_id = p_story and user_id = auth.uid();
end $$;

revoke all on function public.invite_to_story(uuid, text, membership_role) from public;
revoke all on function public.accept_story_invites() from public;
revoke all on function public.story_members(uuid) from public;
revoke all on function public.remove_story_member(uuid, uuid) from public;
revoke all on function public.cancel_story_invite(uuid, text) from public;
revoke all on function public.leave_story(uuid) from public;
grant execute on function public.invite_to_story(uuid, text, membership_role) to authenticated;
grant execute on function public.accept_story_invites() to authenticated;
grant execute on function public.story_members(uuid) to authenticated;
grant execute on function public.remove_story_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_story_invite(uuid, text) to authenticated;
grant execute on function public.leave_story(uuid) to authenticated;
