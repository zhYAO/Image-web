create or replace function public.consume_auth_rate_limit(
  p_action text, p_email_hash text, p_ip_hash text, p_limit integer, p_window_seconds integer,
  p_block_seconds integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target private.auth_rate_limits%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if p_action not in ('login','signup','resend','recovery','verify') or p_limit < 1 or p_window_seconds < 1
    or p_block_seconds < 0 or nullif(p_email_hash,'') is null or nullif(p_ip_hash,'') is null then
    raise exception using errcode = '22023', message = 'invalid rate limit input';
  end if;
  insert into private.auth_rate_limits(action,email_hash,ip_hash,window_started_at,attempts)
  values(p_action,p_email_hash,p_ip_hash,v_now,1)
  on conflict(action,email_hash,ip_hash) do update set
    attempts = case when private.auth_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1 else private.auth_rate_limits.attempts + 1 end,
    window_started_at = case when private.auth_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now else private.auth_rate_limits.window_started_at end,
    blocked_until = case when private.auth_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then null
      when private.auth_rate_limits.window_started_at > v_now - make_interval(secs => p_window_seconds)
      and private.auth_rate_limits.attempts + 1 > p_limit and p_block_seconds > 0
      then v_now + make_interval(secs => p_block_seconds) else private.auth_rate_limits.blocked_until end
  returning * into target;
  return jsonb_build_object('allowed', target.attempts <= p_limit and coalesce(target.blocked_until <= v_now, true),
    'retryAfterSeconds', greatest(0, ceil(extract(epoch from coalesce(target.blocked_until, target.window_started_at + make_interval(secs => p_window_seconds)) - v_now))));
end;
$$;

drop policy if exists account_profiles_select_own on public.account_profiles;
create policy account_profiles_select_own on public.account_profiles for select to authenticated
using (user_id = (select public.require_verified_user_id()));

drop policy if exists account_profiles_update_own on public.account_profiles;
create policy account_profiles_update_own on public.account_profiles for update to authenticated
using (user_id = (select public.require_verified_user_id()))
with check (user_id = (select public.require_verified_user_id()) and status = 'active');

drop policy if exists formal_session_required on public.sessions;
create policy formal_session_required on public.sessions as restrictive for all to authenticated
using ((select public.require_verified_user_id()) is not null)
with check ((select public.require_verified_user_id()) is not null);

drop policy if exists formal_session_required on public.timeline_items;
create policy formal_session_required on public.timeline_items as restrictive for all to authenticated
using ((select public.require_verified_user_id()) is not null)
with check ((select public.require_verified_user_id()) is not null);

drop policy if exists formal_session_required on public.generation_batches;
create policy formal_session_required on public.generation_batches as restrictive for all to authenticated
using ((select public.require_verified_user_id()) is not null)
with check ((select public.require_verified_user_id()) is not null);

drop policy if exists formal_session_required on public.generations;
create policy formal_session_required on public.generations as restrictive for all to authenticated
using ((select public.require_verified_user_id()) is not null)
with check ((select public.require_verified_user_id()) is not null);

drop policy if exists formal_session_required on public.reference_uploads;
create policy formal_session_required on public.reference_uploads as restrictive for all to authenticated
using ((select public.require_verified_user_id()) is not null)
with check ((select public.require_verified_user_id()) is not null);
