create extension if not exists pgmq;

create schema if not exists pgmq_public;
revoke all on schema pgmq, pgmq_public from public, anon, authenticated;
grant usage on schema pgmq to service_role;

select pgmq.create('image_generation');

alter table public.generations
  add column provider_submission_state text not null default 'not_submitted',
  add column provider_request_id text,
  add column attempt_count integer not null default 0,
  add constraint generations_submission_state_check
    check (provider_submission_state in ('not_submitted', 'unknown', 'submitted')),
  add constraint generations_attempt_count_check check (attempt_count >= 0);

create function private.submit_image_generation(
  p_user_id uuid,
  p_session_id uuid,
  p_prompt text,
  p_provider text,
  p_model text,
  p_config jsonb,
  p_source text,
  p_parent_batch_id uuid,
  p_skill_id text,
  p_skill_version text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  current_reserved integer;
  existing_hash text;
  existing_session_id uuid;
  generation_count integer;
  v_generation_id uuid;
  reference_count integer;
  v_session_id uuid;
  utc_day_start timestamptz;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'user_id_required';
  end if;
  if p_source not in ('direct', 'chat_tool') then
    raise exception using errcode = '22023', message = 'invalid_generation_source';
  end if;
  if jsonb_typeof(p_config) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_generation_config';
  end if;
  if (
    select state from private.provider_health_windows
    where provider = p_provider
      and window_start >= timezone('utc', now()) - interval '10 minutes'
    order by window_start desc
    limit 1
  ) = 'unavailable' then
    raise exception using errcode = 'P0001', message = 'provider_unavailable';
  end if;

  generation_count := (p_config ->> 'count')::integer;
  if generation_count not between 1 and 4
    or p_config ->> 'aspectRatio' not in ('1:1', '3:4', '4:3', '9:16', '16:9')
    or p_config ->> 'resolution' not in ('1K', '2K') then
    raise exception using errcode = '22023', message = 'invalid_generation_config';
  end if;

  select generation_batches.id, generation_batches.session_id, generation_batches.request_hash
  into v_batch_id, existing_session_id, existing_hash
  from public.generation_batches
  where generation_batches.user_id = p_user_id
    and generation_batches.idempotency_key = p_idempotency_key;

  if v_batch_id is not null then
    if existing_hash <> p_request_hash then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object(
      'batchId', v_batch_id,
      'deduplicated', true,
      'sessionId', existing_session_id,
      'status', 'pending'
    );
  end if;

  if p_session_id is null then
    insert into public.sessions (user_id, title)
    values (p_user_id, left(btrim(p_prompt), 100))
    returning id into v_session_id;
  else
    select sessions.id into v_session_id
    from public.sessions
    where id = p_session_id and user_id = p_user_id and status = 'active'
    for update;
    if v_session_id is null then
      raise exception using errcode = '42501', message = 'session_not_found';
    end if;
  end if;

  if p_config ? 'referenceIds' then
    if jsonb_typeof(p_config -> 'referenceIds') <> 'array'
      or jsonb_array_length(p_config -> 'referenceIds') > 4 then
      raise exception using errcode = '22023', message = 'invalid_references';
    end if;
    select count(*) into reference_count
    from public.reference_uploads
    where id in (
      select value::uuid from jsonb_array_elements_text(p_config -> 'referenceIds')
    )
      and user_id = p_user_id
      and reference_uploads.session_id = v_session_id
      and status = 'active'
      and upload_expires_at > timezone('utc', now());
    if reference_count <> jsonb_array_length(p_config -> 'referenceIds') then
      raise exception using errcode = '22023', message = 'reference_expired_or_forbidden';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || timezone('utc', now())::date::text, 0));
  utc_day_start := date_trunc('day', timezone('utc', now())) at time zone 'UTC';
  select coalesce(sum(case when entry_type = 'reserve' then amount when entry_type = 'release' then -amount else 0 end), 0)
  into current_reserved
  from private.quota_ledger
  where user_id = p_user_id and created_at >= utc_day_start;

  if current_reserved + generation_count > 30 then
    raise exception using errcode = 'P0001', message = 'quota_exceeded';
  end if;

  v_batch_id := gen_random_uuid();
  insert into public.generation_batches (
    id,
    user_id,
    session_id,
    source,
    prompt,
    provider,
    model,
    config,
    parent_batch_id,
    skill_id,
    skill_version,
    idempotency_key,
    request_hash,
    correlation_id
  ) values (
    v_batch_id,
    p_user_id,
    v_session_id,
    p_source,
    btrim(p_prompt),
    p_provider,
    p_model,
    p_config,
    p_parent_batch_id,
    p_skill_id,
    p_skill_version,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  );

  insert into public.timeline_items (session_id, kind, batch_id, status)
  values (v_session_id, 'generation', v_batch_id, 'pending');

  for generation_index in 1..generation_count loop
    v_generation_id := gen_random_uuid();
    insert into public.generations (
      id,
      batch_id,
      provider,
      model,
      prompt,
      params,
      correlation_id
    ) values (
      v_generation_id,
      v_batch_id,
      p_provider,
      p_model,
      btrim(p_prompt),
      p_config || jsonb_build_object('index', generation_index),
      p_correlation_id
    );

    insert into private.quota_ledger (
      user_id,
      batch_id,
      generation_id,
      entry_type,
      amount,
      business_key
    ) values (
      p_user_id,
      v_batch_id,
      v_generation_id,
      'reserve',
      1,
      'reserve:' || v_generation_id::text
    );

    perform pgmq.send(
      'image_generation',
      jsonb_build_object(
        'version', 1,
        'jobId', gen_random_uuid(),
        'generationId', v_generation_id,
        'idempotencyKey', p_idempotency_key || ':' || v_generation_id::text,
        'correlationId', p_correlation_id
      )
    );
  end loop;

  update public.sessions set updated_at = timezone('utc', now()) where id = v_session_id;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'deduplicated', false,
    'sessionId', v_session_id,
    'status', 'pending'
  );
end;
$$;

create function public.submit_image_generation(
  p_user_id uuid,
  p_session_id uuid,
  p_prompt text,
  p_provider text,
  p_model text,
  p_config jsonb,
  p_source text,
  p_parent_batch_id uuid,
  p_skill_id text,
  p_skill_version text,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.submit_image_generation(
    p_user_id,
    p_session_id,
    p_prompt,
    p_provider,
    p_model,
    p_config,
    p_source,
    p_parent_batch_id,
    p_skill_id,
    p_skill_version,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  );
$$;

revoke all on function private.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)
from public, anon, authenticated;
grant execute on function private.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)
to service_role;

revoke all on function public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)
from public, anon, authenticated;
grant execute on function public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)
to service_role;

create function private.recreate_image_generation(
  p_user_id uuid,
  p_batch_id uuid,
  p_mode text,
  p_generation_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.generation_batches%rowtype;
  selected_count integer;
  recreated_config jsonb;
begin
  select * into original
  from public.generation_batches
  where id = p_batch_id and user_id = p_user_id;

  if original.id is null then
    raise exception using errcode = '42501', message = 'batch_not_found';
  end if;

  if p_mode = 'single' then
    if p_generation_id is null then
      raise exception using errcode = '22023', message = 'generation_id_required';
    end if;
    select count(*) into selected_count
    from public.generations
    where id = p_generation_id and batch_id = p_batch_id;
  elsif p_mode = 'failed' then
    if p_generation_id is not null then
      raise exception using errcode = '22023', message = 'generation_id_not_allowed';
    end if;
    select count(*) into selected_count
    from public.generations
    where batch_id = p_batch_id and status = 'failed';
  elsif p_mode = 'all' then
    if p_generation_id is not null then
      raise exception using errcode = '22023', message = 'generation_id_not_allowed';
    end if;
    select count(*) into selected_count
    from public.generations
    where batch_id = p_batch_id;
  else
    raise exception using errcode = '22023', message = 'invalid_recreate_mode';
  end if;

  if selected_count not between 1 and 4 then
    raise exception using errcode = '22023', message = 'no_generations_to_recreate';
  end if;

  recreated_config := jsonb_set(original.config, '{count}', to_jsonb(selected_count), true);
  return private.submit_image_generation(
    p_user_id,
    original.session_id,
    original.prompt,
    original.provider,
    original.model,
    recreated_config,
    original.source,
    original.id,
    original.skill_id,
    original.skill_version,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  );
end;
$$;

create function public.recreate_image_generation(
  p_user_id uuid,
  p_batch_id uuid,
  p_mode text,
  p_generation_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.recreate_image_generation(
    p_user_id,
    p_batch_id,
    p_mode,
    p_generation_id,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  );
$$;

revoke all on function private.recreate_image_generation(uuid,uuid,text,uuid,text,text,uuid)
from public, anon, authenticated;
grant execute on function private.recreate_image_generation(uuid,uuid,text,uuid,text,text,uuid)
to service_role;

revoke all on function public.recreate_image_generation(uuid,uuid,text,uuid,text,text,uuid)
from public, anon, authenticated;
grant execute on function public.recreate_image_generation(uuid,uuid,text,uuid,text,text,uuid)
to service_role;

create function private.refresh_generation_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_count integer;
  pending_count integer;
  processing_count integer;
  succeeded_count integer;
  total_count integer;
  next_status text;
begin
  select
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'succeeded'),
    count(*) filter (where status = 'failed')
  into total_count, pending_count, processing_count, succeeded_count, failed_count
  from public.generations
  where batch_id = p_batch_id;

  next_status := case
    when processing_count > 0 then 'processing'
    when pending_count > 0 then 'pending'
    when succeeded_count = total_count then 'succeeded'
    when failed_count = total_count then 'failed'
    else 'partial'
  end;

  update public.generation_batches
  set status = next_status
  where id = p_batch_id;

  update public.timeline_items
  set status = next_status
  where batch_id = p_batch_id and kind = 'generation';
end;
$$;

create function private.record_provider_result(p_provider text, p_is_error boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_start timestamptz;
begin
  bucket_start := date_bin(interval '5 minutes', now(), timestamptz '2001-01-01 00:00:00+00');

  insert into private.provider_health_windows (provider, window_start, total_count, error_count, state)
  values (p_provider, bucket_start, 1, case when p_is_error then 1 else 0 end, 'normal')
  on conflict (provider, window_start) do update
  set
    total_count = private.provider_health_windows.total_count + 1,
    error_count = private.provider_health_windows.error_count + case when p_is_error then 1 else 0 end,
    state = case
      when private.provider_health_windows.total_count + 1 >= 10
        and (private.provider_health_windows.error_count + case when p_is_error then 1 else 0 end)::numeric
          / (private.provider_health_windows.total_count + 1) > 0.5 then 'unavailable'
      when (private.provider_health_windows.error_count + case when p_is_error then 1 else 0 end)::numeric
          / (private.provider_health_windows.total_count + 1) >= 0.3 then 'warning'
      else 'normal'
    end;
end;
$$;

create function private.claim_image_generation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message record;
  generation_record record;
  generation_uuid uuid;
  reference_paths jsonb;
begin
  select * into queue_message from pgmq.read('image_generation', 120, 1) limit 1;
  if queue_message.msg_id is null then
    return null;
  end if;

  generation_uuid := (queue_message.message ->> 'generationId')::uuid;
  select
    generations.id,
    generations.status,
    generations.provider_submission_state,
    generations.prompt,
    generations.params,
    generations.provider,
    generations.model,
    generations.batch_id,
    generation_batches.user_id,
    generation_batches.session_id
  into generation_record
  from public.generations
  join public.generation_batches on generation_batches.id = generations.batch_id
  where generations.id = generation_uuid;

  if generation_record.id is null then
    return jsonb_build_object('action', 'archive', 'messageId', queue_message.msg_id, 'reason', 'missing_generation');
  end if;
  if generation_record.status in ('succeeded', 'failed') then
    return jsonb_build_object('action', 'archive', 'messageId', queue_message.msg_id, 'reason', 'terminal_generation');
  end if;
  if generation_record.status = 'processing' and generation_record.provider_submission_state <> 'not_submitted' then
    return jsonb_build_object(
      'action', 'fail_unknown',
      'generationId', generation_uuid,
      'messageId', queue_message.msg_id,
      'reason', 'previous_submission_may_have_been_accepted'
    );
  end if;

  update public.generations
  set status = 'processing', attempt_count = attempt_count + 1
  where id = generation_uuid
    and (status = 'pending' or (status = 'processing' and provider_submission_state = 'not_submitted'));
  perform private.refresh_generation_batch(generation_record.batch_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reference_uploads.id,
    'bucket', reference_uploads.storage_bucket,
    'path', reference_uploads.storage_path,
    'mimeType', reference_uploads.mime_type
  )), '[]'::jsonb)
  into reference_paths
  from public.reference_uploads
  where reference_uploads.id in (
    select value::uuid
    from jsonb_array_elements_text(coalesce(generation_record.params -> 'referenceIds', '[]'::jsonb))
  )
    and reference_uploads.user_id = generation_record.user_id
    and reference_uploads.session_id = generation_record.session_id
    and reference_uploads.status = 'active'
    and reference_uploads.upload_expires_at > timezone('utc', now());

  return jsonb_build_object(
    'action', 'process',
    'messageId', queue_message.msg_id,
    'readCount', queue_message.read_ct,
    'generationId', generation_uuid,
    'batchId', generation_record.batch_id,
    'sessionId', generation_record.session_id,
    'userId', generation_record.user_id,
    'provider', generation_record.provider,
    'model', generation_record.model,
    'prompt', generation_record.prompt,
    'params', generation_record.params,
    'references', reference_paths,
    'correlationId', queue_message.message ->> 'correlationId'
  );
end;
$$;

create function private.mark_provider_submission_started(p_generation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed boolean;
begin
  update public.generations
  set provider_submission_state = 'unknown'
  where id = p_generation_id and status = 'processing' and provider_submission_state = 'not_submitted';
  changed := found;
  return changed;
end;
$$;

create function private.complete_image_generation(
  p_message_id bigint,
  p_generation_id uuid,
  p_storage_path text,
  p_provider_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
  target_provider text;
begin
  update public.generations
  set
    status = 'succeeded',
    provider_submission_state = 'submitted',
    provider_request_id = p_provider_request_id,
    storage_bucket = 'generated',
    storage_path = p_storage_path,
    asset_status = 'active',
    asset_expires_at = timezone('utc', now()) + interval '90 days',
    error_code = null
  where id = p_generation_id and status = 'processing'
  returning batch_id, provider into target_batch_id, target_provider;

  if target_batch_id is null then
    raise exception using errcode = 'P0001', message = 'generation_not_processing';
  end if;

  insert into private.quota_ledger (user_id, batch_id, generation_id, entry_type, amount, business_key)
  select generation_batches.user_id, generations.batch_id, generations.id, 'settle', 1, 'settle:' || generations.id::text
  from public.generations join public.generation_batches on generation_batches.id = generations.batch_id
  where generations.id = p_generation_id
  on conflict (business_key) do nothing;

  perform private.record_provider_result(target_provider, false);
  perform private.refresh_generation_batch(target_batch_id);
  perform pgmq.archive('image_generation', p_message_id);
end;
$$;

create function private.fail_image_generation(
  p_message_id bigint,
  p_generation_id uuid,
  p_error_code text,
  p_release_quota boolean,
  p_submission_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
  target_provider text;
begin
  if p_submission_state not in ('not_submitted', 'unknown', 'submitted') then
    raise exception using errcode = '22023', message = 'invalid_submission_state';
  end if;

  update public.generations
  set
    status = 'failed',
    provider_submission_state = p_submission_state,
    error_code = left(p_error_code, 100)
  where id = p_generation_id and status in ('pending', 'processing')
  returning batch_id, provider into target_batch_id, target_provider;

  if target_batch_id is not null then
    if p_release_quota then
      insert into private.quota_ledger (user_id, batch_id, generation_id, entry_type, amount, business_key)
      select generation_batches.user_id, generations.batch_id, generations.id, 'release', 1, 'release:' || generations.id::text
      from public.generations join public.generation_batches on generation_batches.id = generations.batch_id
      where generations.id = p_generation_id
      on conflict (business_key) do nothing;
    end if;
    perform private.record_provider_result(target_provider, true);
    perform private.refresh_generation_batch(target_batch_id);
  end if;
  perform pgmq.archive('image_generation', p_message_id);
end;
$$;

create function private.retry_image_generation(p_generation_id uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
begin
  update public.generations
  set status = 'pending', error_code = left(p_error_code, 100)
  where id = p_generation_id and status = 'processing' and provider_submission_state = 'not_submitted'
  returning batch_id into target_batch_id;
  if target_batch_id is not null then perform private.refresh_generation_batch(target_batch_id); end if;
  return target_batch_id is not null;
end;
$$;

create function private.archive_image_message(p_message_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.archive('image_generation', p_message_id);
$$;

create function public.claim_image_generation() returns jsonb
language sql set search_path = '' as $$ select private.claim_image_generation(); $$;
create function public.mark_provider_submission_started(p_generation_id uuid) returns boolean
language sql set search_path = '' as $$ select private.mark_provider_submission_started(p_generation_id); $$;
create function public.complete_image_generation(p_message_id bigint, p_generation_id uuid, p_storage_path text, p_provider_request_id text) returns void
language sql set search_path = '' as $$ select private.complete_image_generation(p_message_id, p_generation_id, p_storage_path, p_provider_request_id); $$;
create function public.fail_image_generation(p_message_id bigint, p_generation_id uuid, p_error_code text, p_release_quota boolean, p_submission_state text) returns void
language sql set search_path = '' as $$ select private.fail_image_generation(p_message_id, p_generation_id, p_error_code, p_release_quota, p_submission_state); $$;
create function public.retry_image_generation(p_generation_id uuid, p_error_code text) returns boolean
language sql set search_path = '' as $$ select private.retry_image_generation(p_generation_id, p_error_code); $$;
create function public.archive_image_message(p_message_id bigint) returns boolean
language sql set search_path = '' as $$ select private.archive_image_message(p_message_id); $$;

revoke all on function
  private.refresh_generation_batch(uuid),
  private.record_provider_result(text,boolean),
  private.claim_image_generation(),
  private.mark_provider_submission_started(uuid),
  private.complete_image_generation(bigint,uuid,text,text),
  private.fail_image_generation(bigint,uuid,text,boolean,text),
  private.retry_image_generation(uuid,text),
  private.archive_image_message(bigint)
from public, anon, authenticated;
grant execute on function
  private.refresh_generation_batch(uuid),
  private.record_provider_result(text,boolean),
  private.claim_image_generation(),
  private.mark_provider_submission_started(uuid),
  private.complete_image_generation(bigint,uuid,text,text),
  private.fail_image_generation(bigint,uuid,text,boolean,text),
  private.retry_image_generation(uuid,text),
  private.archive_image_message(bigint)
to service_role;

revoke all on function
  public.claim_image_generation(),
  public.mark_provider_submission_started(uuid),
  public.complete_image_generation(bigint,uuid,text,text),
  public.fail_image_generation(bigint,uuid,text,boolean,text),
  public.retry_image_generation(uuid,text),
  public.archive_image_message(bigint)
from public, anon, authenticated;
grant execute on function
  public.claim_image_generation(),
  public.mark_provider_submission_started(uuid),
  public.complete_image_generation(bigint,uuid,text,text),
  public.fail_image_generation(bigint,uuid,text,boolean,text),
  public.retry_image_generation(uuid,text),
  public.archive_image_message(bigint)
to service_role;

create function private.get_user_quota(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with boundary as (
    select
      date_trunc('day', timezone('utc', now())) at time zone 'UTC' as starts_at,
      (date_trunc('day', timezone('utc', now())) + interval '1 day') at time zone 'UTC' as resets_at
  ), usage as (
    select coalesce(sum(
      case when entry_type = 'reserve' then amount when entry_type = 'release' then -amount else 0 end
    ), 0)::integer as used
    from private.quota_ledger, boundary
    where user_id = p_user_id and created_at >= boundary.starts_at
  )
  select jsonb_build_object(
    'limit', 30,
    'resetsAt', boundary.resets_at,
    'used', greatest(usage.used, 0)
  )
  from boundary, usage;
$$;

create function public.get_user_quota(p_user_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select private.get_user_quota(p_user_id);
$$;

create function private.get_provider_health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with providers(provider) as (
    values ('gemini'::text), ('seedream'::text), ('doubao'::text), ('minimax'::text)
  ), latest as (
    select distinct on (provider) provider, state, updated_at
    from private.provider_health_windows
    where window_start >= timezone('utc', now()) - interval '10 minutes'
    order by provider, window_start desc
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'provider', providers.provider,
    'status', case
      when latest.provider is null then 'degraded'
      when latest.state = 'warning' then 'degraded'
      when latest.state = 'unavailable' then 'unavailable'
      else 'healthy'
    end,
    'checkedAt', coalesce(latest.updated_at, timezone('utc', now())),
    'message', case latest.state
      when 'warning' then '近期错误率升高，提交前请确认。'
      when 'unavailable' then '服务暂时不可用，请选择其他 provider。'
      else case when latest.provider is null then '尚无近期运行样本，请在提交前确认。' else null end
    end
  )) order by providers.provider), '[]'::jsonb)
  from providers left join latest using (provider);
$$;

create function public.get_provider_health()
returns jsonb
language sql
set search_path = ''
as $$
  select private.get_provider_health();
$$;

revoke all on function private.get_user_quota(uuid), private.get_provider_health()
from public, anon, authenticated;
grant execute on function private.get_user_quota(uuid), private.get_provider_health()
to service_role;

revoke all on function public.get_user_quota(uuid), public.get_provider_health()
from public, anon, authenticated;
grant execute on function public.get_user_quota(uuid), public.get_provider_health()
to service_role;
