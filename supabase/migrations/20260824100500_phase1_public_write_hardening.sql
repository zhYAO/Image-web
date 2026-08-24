revoke insert on table public.sessions from authenticated;
revoke update (title) on table public.sessions from authenticated;
revoke insert on table public.reference_uploads from authenticated;

drop policy sessions_insert_own on public.sessions;
drop policy sessions_update_own_active on public.sessions;
drop policy reference_uploads_insert_own on public.reference_uploads;

alter table private.preview_usage_ledger
drop constraint preview_usage_business_metric_unique;

alter table private.preview_usage_ledger
add constraint preview_usage_user_business_metric_unique
unique (user_id, business_key, metric);

drop function public.commit_preview_usage(text);
drop function public.release_preview_usage(text);
drop function private.commit_preview_usage(text);
drop function private.release_preview_usage(text);

create function private.commit_preview_usage(p_user_id uuid, p_business_key text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update private.preview_usage_ledger
    set state = 'committed'
    where user_id = p_user_id
      and business_key = p_business_key
      and state = 'reserved'
    returning 1
  )
  select exists(select 1 from changed)
    or exists(
      select 1 from private.preview_usage_ledger
      where user_id = p_user_id
        and business_key = p_business_key
        and state = 'committed'
    );
$$;

create function private.release_preview_usage(
  p_user_id uuid,
  p_business_key text,
  p_correlation_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with changed as (
    update private.preview_usage_ledger
    set state = 'released'
    where user_id = p_user_id
      and business_key = p_business_key
      and correlation_id = p_correlation_id
      and state = 'reserved'
    returning 1
  )
  select exists(select 1 from changed)
    or exists(
      select 1 from private.preview_usage_ledger
      where user_id = p_user_id
        and business_key = p_business_key
        and correlation_id = p_correlation_id
        and state = 'released'
    );
$$;

create function public.commit_preview_usage(p_user_id uuid, p_business_key text)
returns boolean
language sql
set search_path = ''
as $$ select private.commit_preview_usage(p_user_id, p_business_key); $$;

create function public.release_preview_usage(
  p_user_id uuid,
  p_business_key text,
  p_correlation_id uuid
)
returns boolean
language sql
set search_path = ''
as $$ select private.release_preview_usage(p_user_id, p_business_key, p_correlation_id); $$;

revoke all on function
  private.commit_preview_usage(uuid,text),
  private.release_preview_usage(uuid,text,uuid),
  public.commit_preview_usage(uuid,text),
  public.release_preview_usage(uuid,text,uuid)
from public, anon, authenticated;

grant execute on function
  private.commit_preview_usage(uuid,text),
  private.release_preview_usage(uuid,text,uuid),
  public.commit_preview_usage(uuid,text),
  public.release_preview_usage(uuid,text,uuid)
to service_role;

create or replace function private.reserve_preview_usage(
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
    where user_id = p_user_id
      and business_key = p_business_key
      and state <> 'released'
  ) then
    return true;
  end if;
  delete from private.preview_usage_ledger
  where user_id = p_user_id
    and business_key = p_business_key
    and state = 'released';

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
