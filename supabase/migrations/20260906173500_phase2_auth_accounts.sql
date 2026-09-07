create type public.account_status as enum ('active', 'deleting');

create table public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  status public.account_status not null default 'active',
  accepted_legal_version text,
  accepted_legal_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table private.auth_rate_limits (
  action text not null check (action in ('login', 'signup', 'resend', 'recovery', 'verify')),
  email_hash text not null,
  ip_hash text not null,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  blocked_until timestamptz,
  primary key (action, email_hash, ip_hash)
);

create table private.account_cleanup_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed', 'completed')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default timezone('utc', now()),
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from public, anon, authenticated;
grant select (user_id, display_name, status, created_at, updated_at), update (display_name) on public.account_profiles to authenticated;

create function private.is_verified_live_session(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join auth.sessions s on s.user_id = u.id
    where u.id = p_user_id
      and u.is_anonymous is false
      and u.email_confirmed_at is not null
      and s.id = nullif(auth.jwt()->>'session_id', '')::uuid
      and (s.not_after is null or s.not_after > timezone('utc', now()))
  );
$$;
create function private.is_verified_live_user(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_verified_live_session(p_user_id) and exists (
    select 1 from public.account_profiles where user_id=p_user_id and status='active'
  );
$$;

create function public.require_verified_user_id()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_verified_live_user(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'unauthorized';
  end if;
  return auth.uid();
end;
$$;

create policy account_profiles_select_own on public.account_profiles for select to authenticated
using (user_id = auth.uid() and private.is_verified_live_user(user_id));
create policy account_profiles_update_own on public.account_profiles for update to authenticated
using (user_id = auth.uid() and private.is_verified_live_user(user_id))
with check (user_id = auth.uid() and status = 'active');

create policy formal_session_required on public.sessions as restrictive for all to authenticated
using (private.is_verified_live_user(auth.uid())) with check (private.is_verified_live_user(auth.uid()));
create policy formal_session_required on public.timeline_items as restrictive for all to authenticated
using (private.is_verified_live_user(auth.uid())) with check (private.is_verified_live_user(auth.uid()));
create policy formal_session_required on public.generation_batches as restrictive for all to authenticated
using (private.is_verified_live_user(auth.uid())) with check (private.is_verified_live_user(auth.uid()));
create policy formal_session_required on public.generations as restrictive for all to authenticated
using (private.is_verified_live_user(auth.uid())) with check (private.is_verified_live_user(auth.uid()));
create policy formal_session_required on public.reference_uploads as restrictive for all to authenticated
using (private.is_verified_live_user(auth.uid())) with check (private.is_verified_live_user(auth.uid()));

create function private.create_account_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_anonymous is false then
    insert into public.account_profiles(user_id, accepted_legal_version, accepted_legal_at)
    values (
      new.id,
      nullif(new.raw_user_meta_data->>'accepted_legal_version', ''),
      case when nullif(new.raw_user_meta_data->>'accepted_legal_version', '') is null then null else timezone('utc', now()) end
    ) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger create_account_profile after insert or update of is_anonymous on auth.users
for each row execute function private.create_account_profile();

insert into public.account_profiles(user_id)
select id from auth.users where is_anonymous is false
on conflict(user_id) do nothing;

create function public.consume_auth_rate_limit(
  p_action text, p_email_hash text, p_ip_hash text, p_limit integer, p_window_seconds integer,
  p_block_seconds integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target private.auth_rate_limits%rowtype; current_time timestamptz := timezone('utc', now());
begin
  if p_action not in ('login','signup','resend','recovery','verify') or p_limit < 1 or p_window_seconds < 1
    or p_block_seconds < 0 or nullif(p_email_hash,'') is null or nullif(p_ip_hash,'') is null then
    raise exception using errcode = '22023', message = 'invalid rate limit input';
  end if;
  insert into private.auth_rate_limits(action,email_hash,ip_hash,window_started_at,attempts)
  values(p_action,p_email_hash,p_ip_hash,current_time,1)
  on conflict(action,email_hash,ip_hash) do update set
    attempts = case when private.auth_rate_limits.window_started_at <= current_time - make_interval(secs => p_window_seconds) then 1 else private.auth_rate_limits.attempts + 1 end,
    window_started_at = case when private.auth_rate_limits.window_started_at <= current_time - make_interval(secs => p_window_seconds) then current_time else private.auth_rate_limits.window_started_at end,
    blocked_until = case when private.auth_rate_limits.window_started_at <= current_time - make_interval(secs => p_window_seconds) then null
      when private.auth_rate_limits.window_started_at > current_time - make_interval(secs => p_window_seconds)
      and private.auth_rate_limits.attempts + 1 > p_limit and p_block_seconds > 0
      then current_time + make_interval(secs => p_block_seconds) else private.auth_rate_limits.blocked_until end
  returning * into target;
  return jsonb_build_object('allowed', target.attempts <= p_limit and coalesce(target.blocked_until <= current_time, true),
    'retryAfterSeconds', greatest(0, ceil(extract(epoch from coalesce(target.blocked_until, target.window_started_at + make_interval(secs => p_window_seconds)) - current_time))));
end;
$$;

create function public.request_account_deletion()
returns boolean language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  target := auth.uid();
  if not private.is_verified_live_session(target) then raise exception using errcode='P0001',message='unauthorized'; end if;
  if exists(select 1 from public.account_profiles where user_id=target and status='deleting') then return true; end if;
  update public.account_profiles set status = 'deleting', updated_at = timezone('utc', now()) where user_id = target;
  update public.generations g set status='failed',error_code='account_deleting',updated_at=timezone('utc',now())
    from public.generation_batches b where b.id=g.batch_id and b.user_id=target and g.status in ('pending','processing');
  update public.generation_batches set status='failed',updated_at=timezone('utc',now())
    where user_id=target and status in ('pending','processing','partial');
  insert into private.account_cleanup_jobs(user_id) values(target) on conflict(user_id) do nothing;
  return true;
end;
$$;

create function public.claim_account_cleanup_job() returns jsonb language plpgsql security definer set search_path = '' as $$
declare target private.account_cleanup_jobs%rowtype; objects jsonb;
begin
  select * into target from private.account_cleanup_jobs where status in ('pending','failed') and attempts < 5
    and next_run_at <= timezone('utc', now()) order by next_run_at for update skip locked limit 1;
  if target.user_id is null then return null; end if;
  update private.account_cleanup_jobs set status='processing', attempts=attempts+1, updated_at=timezone('utc', now())
    where user_id=target.user_id returning * into target;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into objects from (
    select jsonb_build_object('bucket',storage_bucket,'path',storage_path) item from public.reference_uploads
      where user_id=target.user_id and status <> 'deleted'
    union all
    select jsonb_build_object('bucket',g.storage_bucket,'path',g.storage_path) from public.generations g
      join public.generation_batches b on b.id=g.batch_id where b.user_id=target.user_id and g.storage_path is not null
  ) paths;
  return jsonb_build_object('attempt',target.attempts,'jobType','account_delete','objects',objects,'targetId',target.user_id);
end;
$$;

create function public.complete_account_cleanup_job(p_user_id uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.account_cleanup_jobs set status='completed',updated_at=timezone('utc',now()) where user_id=p_user_id and status='processing';
  return found;
end;
$$;
create function public.fail_account_cleanup_job(p_user_id uuid,p_error_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target private.account_cleanup_jobs%rowtype;
begin
  update private.account_cleanup_jobs set status='failed',error_code=left(p_error_code,100),updated_at=timezone('utc',now()),
    next_run_at=timezone('utc',now())+make_interval(secs=>least(3600,30*(2^greatest(attempts-1,0))))
    where user_id=p_user_id and status='processing' returning * into target;
  return jsonb_build_object('attempts',target.attempts,'dead',coalesce(target.attempts>=5,false));
end;
$$;

revoke all on function private.is_verified_live_session(uuid), private.is_verified_live_user(uuid), private.create_account_profile(),
  public.require_verified_user_id(), public.consume_auth_rate_limit(text,text,text,integer,integer,integer),
  public.request_account_deletion(), public.claim_account_cleanup_job(), public.complete_account_cleanup_job(uuid),
  public.fail_account_cleanup_job(uuid,text) from public,anon,authenticated;
grant execute on function public.require_verified_user_id(), public.request_account_deletion() to authenticated;
grant execute on function public.consume_auth_rate_limit(text,text,text,integer,integer,integer) to service_role;
grant execute on function public.claim_account_cleanup_job(), public.complete_account_cleanup_job(uuid), public.fail_account_cleanup_job(uuid,text) to service_role;
