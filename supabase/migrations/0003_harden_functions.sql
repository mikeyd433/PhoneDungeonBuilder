-- Hardening pass, driven by Supabase's security advisor after 0002.
--
-- Two classes of finding:
--
--   1. Mutable search_path on every function. A function without a pinned
--      search_path can be hijacked by a caller who puts a same-named table or
--      operator earlier on their path. Pin all of them to public.
--
--   2. Trigger functions were reachable as REST RPC endpoints (/rest/v1/rpc/...)
--      by both anon and authenticated. They are trigger plumbing and nothing
--      should be able to call them directly, least of all the two that are
--      SECURITY DEFINER. Revoking EXECUTE does not affect trigger firing —
--      Postgres checks EXECUTE when the trigger is created, not each time it
--      fires.
--
-- delve_role and delve_can_write intentionally keep EXECUTE for authenticated:
-- RLS policy expressions are evaluated as the querying role, so the role must be
-- able to call the helpers its own policies depend on. They leak nothing beyond
-- what memberships_select already exposes.

alter function public.touch_updated_at() set search_path = public;
alter function public.enforce_choice_story() set search_path = public;
alter function public.enforce_effect_story() set search_path = public;
alter function public.enforce_gate_story() set search_path = public;
alter function public.delve_can_write(uuid) set search_path = public;

-- Trigger functions: not part of the API surface.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.enforce_choice_story() from public, anon, authenticated;
revoke all on function public.enforce_effect_story() from public, anon, authenticated;
revoke all on function public.enforce_gate_story() from public, anon, authenticated;
revoke all on function public.seed_owner_membership() from public, anon, authenticated;
revoke all on function public.restrict_voice_node_updates() from public, anon, authenticated;

-- The helpers stay callable by signed-in users only. `revoke ... from public`
-- in 0002 dropped the PUBLIC pseudo-role grant but left anon's own grant, which
-- is what the advisor caught.
revoke all on function public.delve_role(uuid) from public, anon;
revoke all on function public.delve_can_write(uuid) from public, anon;
grant execute on function public.delve_role(uuid) to authenticated;
grant execute on function public.delve_can_write(uuid) to authenticated;
