-- Additive model admission; no credentials, prices, enabled providers or historical rewrites.
alter table private.provider_runtime_config drop constraint provider_runtime_config_provider_check;
alter table private.provider_runtime_config add constraint provider_runtime_config_provider_check check(provider in ('gemini','seedream','doubao','minimax','openai','gpt-6-astra','gpt-6.1-sol'));
insert into private.provider_runtime_config(provider,enabled,evidence)values('openai',false,'user_requested_pending_key_price_and_live_acceptance'),('gpt-6-astra',false,'user_requested_pending_key_price_and_live_acceptance'),('gpt-6.1-sol',false,'user_requested_pending_key_price_and_live_acceptance');

create or replace function private.submit_image_generation(
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

  -- Check only new work: committed submissions above keep their original IDs.
  if not ((p_provider='seedream' and p_model='doubao-seedream-5.0-pro' and p_config->>'resolution'='2K')
    or (p_provider='openai' and p_model in ('gpt-image-2.6-sunburst','gpt-image-2.6-flare') and p_config->>'resolution'='1K' and p_config->>'aspectRatio'='1:1' and not(p_config?'targetWidth') and not(p_config?'targetHeight'))) is distinct from false then
    raise exception using errcode='22023', message='image_model_upgrade_required';
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
      or jsonb_array_length(p_config -> 'referenceIds') > (case when p_skill_id='commerce' then case when p_provider='seedream' then 10 else 14 end else 4 end) then
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

  if current_reserved + generation_count > (case when p_skill_id='commerce' and coalesce((select enabled from private.credit_settings where singleton),false) then 640 else 30 end) then
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
-- Explicit operator price versions can append the four new identities. No default
-- price is invented. Preserve every existing key and all immutable old versions.
alter function public.credit_admin(jsonb) rename to credit_admin_before_openai;
revoke all on function public.credit_admin_before_openai(jsonb) from public,anon,authenticated,service_role;
create function public.credit_admin(p_input jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare prior jsonb;prices jsonb;item jsonb;old_prices jsonb;allowed jsonb:='[{"operation":"chat","provider":"gpt-6-astra","model":"gpt-6-astra","resolution":""},{"operation":"chat","provider":"gpt-6.1-sol","model":"gpt-6.1-sol","resolution":""},{"operation":"image","provider":"openai","model":"gpt-image-2.6-sunburst","resolution":"1K"},{"operation":"image","provider":"openai","model":"gpt-image-2.6-flare","resolution":"1K"}]';
begin
 if p_input->>'action' is distinct from 'price' then return public.credit_admin_before_openai(p_input);end if;
 if length(btrim(coalesce(p_input->>'reason','')))<3 or length(btrim(coalesce(p_input->>'actor','')))<1 then raise exception 'credit_audit_reason_required';end if;
 if not coalesce((p_input->>'apply')::boolean,false)then return public.credit_admin_before_openai(p_input);end if;
 if p_input->>'requestId' is null then raise exception 'credit_request_id_required';end if;
 -- Serialize versions and idempotent audit, including simultaneous operators.
 perform 1 from private.credit_settings where singleton=true for update;
 select input into prior from private.credit_admin_audit where request_id=(p_input->>'requestId')::uuid;
 if found then if prior<>p_input then raise exception 'idempotency_conflict';end if;return jsonb_build_object('replayed',true);end if;
 if coalesce(length(p_input->>'version'),0)not between 1 and 100 then raise exception 'invalid_credit_version';end if;
 prices:=p_input->'prices';select v.prices into old_prices from private.credit_price_versions v join private.credit_settings s on s.version=v.version where s.singleton;
 if jsonb_typeof(prices) is distinct from 'array' then raise exception 'invalid_credit_prices';end if;
 if exists(select 1 from jsonb_array_elements(old_prices)p where not exists(select 1 from jsonb_array_elements(prices)n where n-'unitMinor'-'label'=p-'unitMinor'-'label'))then raise exception 'invalid_credit_prices';end if;
 for item in select value from jsonb_array_elements(prices)loop
  if jsonb_typeof(item->'label') is distinct from 'string' or coalesce(length(item->>'label'),0)not between 1 and 100 or jsonb_typeof(item->'unitMinor')is distinct from 'number' or coalesce(item->>'unitMinor','')!~'^[0-9]{1,7}$' or (item->>'unitMinor')::bigint not between 1 and 1000000 or not exists(select 1 from jsonb_array_elements(old_prices||allowed)p where p-'unitMinor'-'label'=item-'unitMinor'-'label')then raise exception 'invalid_credit_prices';end if;
 end loop;
 if (select count(distinct(p-'unitMinor'-'label'))from jsonb_array_elements(prices)p)<>jsonb_array_length(prices)then raise exception 'invalid_credit_prices';end if;
 insert into private.credit_price_versions(version,prices)values(p_input->>'version',prices);
 update private.credit_settings set version=p_input->>'version'where singleton=true;
 insert into private.credit_admin_audit(request_id,input)values((p_input->>'requestId')::uuid,p_input);
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.credit_admin(jsonb) from public,anon,authenticated;
grant execute on function public.credit_admin(jsonb) to service_role;
