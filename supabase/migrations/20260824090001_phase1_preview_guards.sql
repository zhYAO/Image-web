create table private.provider_runtime_config (
  provider text primary key,
  enabled boolean not null default false,
  evidence text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint provider_runtime_config_provider_check
    check (provider in ('gemini', 'seedream', 'doubao', 'minimax')),
  constraint provider_runtime_config_evidence_check
    check (char_length(btrim(evidence)) between 5 and 500)
);

insert into private.provider_runtime_config (provider, enabled, evidence)
values
  ('gemini', false, 'strict_zero_no_free_image_api_tier'),
  ('seedream', false, 'strict_zero_free_credit_not_verified'),
  ('doubao', false, 'strict_zero_free_credit_not_verified'),
  -- Phase 1 chat ships with MiniMax pre-enabled so a configured
  -- MINIMAX_API_KEY / ZIMAGE_MINIMAX_CHAT_MODEL pair is usable out of the
  -- box. Image and the other chat provider stay disabled until their
  -- respective cost / hard-limit gates are independently approved.
  ('minimax', true, 'phase1_default_enabled_minimax_chat_provider');

create table private.runtime_flags (
  flag text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint runtime_flags_name_check check (flag in ('upload_enabled', 'generation_enabled'))
);

insert into private.runtime_flags (flag, enabled)
values ('upload_enabled', true), ('generation_enabled', false);

create table private.preview_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  metric text not null,
  amount bigint not null,
  state text not null default 'reserved',
  business_key text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint preview_usage_operation_check check (
    operation in (
      'chat', 'generation', 'generation_recreate', 'session_create',
      'session_delete', 'session_update', 'upload'
    )
  ),
  constraint preview_usage_metric_check check (
    metric in ('write', 'session', 'upload_count', 'upload_bytes')
  ),
  constraint preview_usage_amount_check check (amount > 0),
  constraint preview_usage_state_check check (state in ('reserved', 'committed', 'released')),
  constraint preview_usage_business_key_check check (char_length(business_key) between 5 and 200),
  constraint preview_usage_business_metric_unique unique (business_key, metric)
);

create index preview_usage_user_metric_created_idx
on private.preview_usage_ledger (user_id, metric, created_at);

create index preview_usage_metric_created_idx
on private.preview_usage_ledger (metric, created_at);

create index preview_usage_released_created_idx
on private.preview_usage_ledger (created_at)
where state = 'released';

alter table private.provider_runtime_config enable row level security;
alter table private.runtime_flags enable row level security;
alter table private.preview_usage_ledger enable row level security;

revoke all on table
  private.provider_runtime_config,
  private.runtime_flags,
  private.preview_usage_ledger
from public, anon, authenticated;

create trigger provider_runtime_config_set_updated_at
before update on private.provider_runtime_config
for each row execute function private.set_updated_at();

create trigger runtime_flags_set_updated_at
before update on private.runtime_flags
for each row execute function private.set_updated_at();

create function private.reserve_preview_usage(
  p_user_id uuid,
  p_operation text,
  p_bytes bigint,
  p_creates_session boolean,
  p_business_key text,
  p_correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_global_upload_bytes bigint;
  current_global_upload_count bigint;
  current_session_count bigint;
  current_upload_bytes bigint;
  current_upload_count bigint;
  current_write_count bigint;
  utc_day_start timestamptz;
  utc_hour_start timestamptz;
begin
  if p_user_id is null
    or p_correlation_id is null
    or p_operation not in (
      'chat', 'generation', 'generation_recreate', 'session_create',
      'session_delete', 'session_update', 'upload'
    )
    or p_bytes < 0
    or char_length(p_business_key) not between 5 and 200 then
    raise exception using errcode = '22023', message = 'invalid_preview_usage_request';
  end if;
  if p_operation <> 'upload' and p_bytes <> 0 then
    raise exception using errcode = '22023', message = 'invalid_preview_usage_bytes';
  end if;

  if p_operation = 'upload' and not coalesce((
    select enabled from private.runtime_flags where flag = 'upload_enabled'
  ), false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled:upload';
  end if;
  if p_operation in ('generation', 'generation_recreate') and not coalesce((
    select enabled from private.runtime_flags where flag = 'generation_enabled'
  ), false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled:generation';
  end if;

  utc_day_start := date_trunc('day', timezone('utc', now())) at time zone 'UTC';
  utc_hour_start := date_trunc('hour', timezone('utc', now())) at time zone 'UTC';

  perform pg_advisory_xact_lock(hashtextextended('preview-global:' || utc_day_start::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('preview-user:' || p_user_id::text, 0));

  if exists (
    select 1 from private.preview_usage_ledger
    where business_key = p_business_key and state <> 'released'
  ) then
    return true;
  end if;
  delete from private.preview_usage_ledger where business_key = p_business_key and state = 'released';

  select coalesce(sum(amount), 0) into current_write_count
  from private.preview_usage_ledger
  where user_id = p_user_id and metric = 'write' and state <> 'released'
    and created_at >= utc_hour_start;
  if current_write_count + 1 > 60 then
    raise exception using errcode = 'P0001', message = 'preview_quota_exceeded:write_hour';
  end if;

  if p_creates_session then
    select coalesce(sum(amount), 0) into current_session_count
    from private.preview_usage_ledger
    where user_id = p_user_id and metric = 'session' and state <> 'released'
      and created_at >= utc_day_start;
    if current_session_count + 1 > 10 then
      raise exception using errcode = 'P0001', message = 'preview_quota_exceeded:session_day';
    end if;
  end if;

  if p_operation = 'upload' then
    select
      coalesce(sum(amount) filter (where metric = 'upload_count'), 0),
      coalesce(sum(amount) filter (where metric = 'upload_bytes'), 0)
    into current_upload_count, current_upload_bytes
    from private.preview_usage_ledger
    where user_id = p_user_id and state <> 'released' and created_at >= utc_day_start
      and metric in ('upload_count', 'upload_bytes');
    if current_upload_count + 1 > 10 or current_upload_bytes + p_bytes > 50 * 1024 * 1024 then
      raise exception using errcode = 'P0001', message = 'preview_quota_exceeded:upload_user_day';
    end if;

    select
      coalesce(sum(amount) filter (where metric = 'upload_count'), 0),
      coalesce(sum(amount) filter (where metric = 'upload_bytes'), 0)
    into current_global_upload_count, current_global_upload_bytes
    from private.preview_usage_ledger
    where state <> 'released' and created_at >= utc_day_start
      and metric in ('upload_count', 'upload_bytes');
    if current_global_upload_count + 1 > 200 or current_global_upload_bytes + p_bytes > 500 * 1024 * 1024 then
      raise exception using errcode = 'P0001', message = 'preview_quota_exceeded:upload_global_day';
    end if;
  end if;

  insert into private.preview_usage_ledger (
    user_id, operation, metric, amount, business_key, correlation_id
  ) values (p_user_id, p_operation, 'write', 1, p_business_key, p_correlation_id);

  if p_creates_session then
    insert into private.preview_usage_ledger (
      user_id, operation, metric, amount, business_key, correlation_id
    ) values (p_user_id, p_operation, 'session', 1, p_business_key, p_correlation_id);
  end if;

  if p_operation = 'upload' then
    insert into private.preview_usage_ledger (
      user_id, operation, metric, amount, business_key, correlation_id
    ) values
      (p_user_id, p_operation, 'upload_count', 1, p_business_key, p_correlation_id),
      (p_user_id, p_operation, 'upload_bytes', p_bytes, p_business_key, p_correlation_id);
  end if;

  return true;
end;
$$;

create function private.commit_preview_usage(p_business_key text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update private.preview_usage_ledger
    set state = 'committed'
    where business_key = p_business_key and state = 'reserved'
    returning 1
  )
  select exists(select 1 from changed)
    or exists(select 1 from private.preview_usage_ledger where business_key = p_business_key and state = 'committed');
$$;

create function private.release_preview_usage(p_business_key text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update private.preview_usage_ledger
    set state = 'released'
    where business_key = p_business_key and state <> 'released'
    returning 1
  )
  select exists(select 1 from changed)
    or exists(select 1 from private.preview_usage_ledger where business_key = p_business_key and state = 'released');
$$;

create function private.prune_preview_usage()
returns bigint
language sql
security definer
set search_path = ''
as $$
  with removed as (
    delete from private.preview_usage_ledger
    where created_at < timezone('utc', now()) - interval '8 days'
      or (state = 'released' and created_at < timezone('utc', now()) - interval '1 day')
    returning 1
  )
  select count(*) from removed;
$$;

create function private.set_provider_runtime_enabled(p_provider text, p_enabled boolean, p_evidence text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(p_evidence)) not between 5 and 500 then
    raise exception using errcode = '22023', message = 'provider_evidence_required';
  end if;
  update private.provider_runtime_config
  set enabled = p_enabled, evidence = btrim(p_evidence)
  where provider = p_provider;
  if not found then
    raise exception using errcode = '22023', message = 'unknown_provider';
  end if;
  return true;
end;
$$;

create function private.set_runtime_flag(p_flag text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.runtime_flags set enabled = p_enabled where flag = p_flag;
  if not found then
    raise exception using errcode = '22023', message = 'unknown_runtime_flag';
  end if;
  return true;
end;
$$;

create function private.assert_generation_runtime_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((
    select enabled from private.runtime_flags where flag = 'generation_enabled'
  ), false) or not coalesce((
    select enabled from private.provider_runtime_config where provider = new.provider
  ), false) then
    raise exception using errcode = 'P0001', message = 'provider_unavailable';
  end if;
  return new;
end;
$$;

create trigger generation_batches_require_enabled_provider
before insert on public.generation_batches
for each row execute function private.assert_generation_runtime_available();

create or replace function public.assert_chat_provider_available(p_provider text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce((
    select config.enabled and coalesce(health.state <> 'unavailable', true)
    from private.provider_runtime_config config
    left join lateral (
      select state from private.provider_health_windows
      where provider = config.provider
        and window_start >= timezone('utc', now()) - interval '10 minutes'
      order by window_start desc
      limit 1
    ) health on true
    where config.provider = p_provider
  ), false);
$$;

create or replace function private.get_provider_health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (provider) provider, state, updated_at
    from private.provider_health_windows
    where window_start >= timezone('utc', now()) - interval '10 minutes'
    order by provider, window_start desc
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'provider', config.provider,
    'status', case
      when not config.enabled then 'unavailable'
      when latest.provider is null or latest.state = 'warning' then 'degraded'
      when latest.state = 'unavailable' then 'unavailable'
      else 'healthy'
    end,
    'checkedAt', coalesce(latest.updated_at, config.updated_at),
    'message', case
      when not config.enabled then '严格零费用模式下尚未验证可用额度，服务保持关闭。'
      when latest.state = 'warning' then '近期错误率升高，提交前请确认。'
      when latest.state = 'unavailable' then '服务暂时不可用，请选择其他 provider。'
      when latest.provider is null then '尚无近期运行样本，请在提交前确认。'
      else null
    end
  )) order by config.provider), '[]'::jsonb)
  from private.provider_runtime_config config
  left join latest using (provider);
$$;

create function public.reserve_preview_usage(
  p_user_id uuid,
  p_operation text,
  p_bytes bigint,
  p_creates_session boolean,
  p_business_key text,
  p_correlation_id uuid
)
returns boolean
language sql
set search_path = ''
as $$
  select private.reserve_preview_usage(
    p_user_id, p_operation, p_bytes, p_creates_session, p_business_key, p_correlation_id
  );
$$;

create function public.commit_preview_usage(p_business_key text)
returns boolean language sql set search_path = ''
as $$ select private.commit_preview_usage(p_business_key); $$;

create function public.release_preview_usage(p_business_key text)
returns boolean language sql set search_path = ''
as $$ select private.release_preview_usage(p_business_key); $$;

create function public.prune_preview_usage()
returns bigint language sql set search_path = ''
as $$ select private.prune_preview_usage(); $$;

create function public.set_provider_runtime_enabled(p_provider text, p_enabled boolean, p_evidence text)
returns boolean language sql set search_path = ''
as $$ select private.set_provider_runtime_enabled(p_provider, p_enabled, p_evidence); $$;

create function public.set_runtime_flag(p_flag text, p_enabled boolean)
returns boolean language sql set search_path = ''
as $$ select private.set_runtime_flag(p_flag, p_enabled); $$;

revoke all on function
  private.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid),
  private.commit_preview_usage(text),
  private.release_preview_usage(text),
  private.prune_preview_usage(),
  private.set_provider_runtime_enabled(text,boolean,text),
  private.set_runtime_flag(text,boolean),
  private.assert_generation_runtime_available()
from public, anon, authenticated;

grant execute on function
  private.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid),
  private.commit_preview_usage(text),
  private.release_preview_usage(text),
  private.prune_preview_usage(),
  private.set_provider_runtime_enabled(text,boolean,text),
  private.set_runtime_flag(text,boolean),
  private.assert_generation_runtime_available()
to service_role;

revoke all on function
  public.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid),
  public.commit_preview_usage(text),
  public.release_preview_usage(text),
  public.prune_preview_usage(),
  public.set_provider_runtime_enabled(text,boolean,text),
  public.set_runtime_flag(text,boolean)
from public, anon, authenticated;

grant execute on function
  public.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid),
  public.commit_preview_usage(text),
  public.release_preview_usage(text),
  public.prune_preview_usage(),
  public.set_provider_runtime_enabled(text,boolean,text),
  public.set_runtime_flag(text,boolean)
to service_role;
