-- New admissions use Seedream 5.0. Existing jobs, compiled prompts and price versions stay immutable.
insert into private.credit_price_versions(version,prices)
select '2026-10-06.1', coalesce(jsonb_agg(p) filter(where p->>'provider'<>'seedream'),'[]'::jsonb) || '[
 {"operation":"image","provider":"seedream","model":"seedream-5.0-flash","resolution":"2K","unitMinor":30,"label":"Seedream 5.0 Flash · 2K"},
 {"operation":"image","provider":"seedream","model":"seedream-5.0-pro","resolution":"2K","unitMinor":30,"label":"Seedream 5.0 Pro · 2K"}
]'::jsonb from private.credit_price_versions v join private.credit_settings s on s.version=v.version, jsonb_array_elements(v.prices) p where s.singleton;
update private.credit_settings set version='2026-10-06.1' where singleton=true;

create or replace function private.commerce_validate_plan(p_plan jsonb, p_compiled jsonb)
returns void language plpgsql set search_path = '' as $$
declare slot jsonb; compiled_slot jsonb; brief jsonb; slot_count integer;
begin
  if (jsonb_typeof(p_plan) = 'object'
    and p_plan->>'scene' in ('product-main','product-set','detail','clone','social','style-reference','model','xhs-poster')
    and char_length(p_plan->>'templateId') > 0
    and jsonb_typeof(p_plan->'brief') = 'object'
    and jsonb_typeof(p_plan->'slots') = 'array'
    and jsonb_typeof(p_compiled) = 'array') is distinct from true then
    raise exception using errcode='22023', message='invalid_commerce_plan';
  end if;
  brief := p_plan->'brief';
  if (jsonb_typeof(brief->'name') = 'string' and char_length(brief->>'name') <= 160
    and jsonb_typeof(brief->'facts') = 'string' and char_length(brief->>'facts') <= 4000
    and jsonb_typeof(brief->'sellingPoints') = 'string' and char_length(brief->>'sellingPoints') <= 2000
    and jsonb_typeof(brief->'placement') = 'string' and char_length(brief->>'placement') <= 120
    and brief->>'platform' in ('taobao','tmall','jd','pinduoduo','douyin','xiaohongshu','amazon','shopee','tiktok','shopify')
    and (not (brief ? 'region') or brief->>'region' in ('cn','us','eu','jp','kr','sea','other'))
    and (not (brief ? 'language') or brief->>'language' in ('zh-CN','en','ja','ko','es','de','fr','none'))
    and (not (brief ? 'cloneMode') or brief->>'cloneMode' in ('style','faithful'))
    and jsonb_typeof(brief->'productReferenceIds') = 'array'
    and jsonb_typeof(brief->'styleReferenceIds') = 'array') is distinct from true then
    raise exception using errcode='22023', message='invalid_commerce_brief';
  end if;
  -- Missing mode remains product for saved revisions created before this migration.
  if (not (brief ? 'contentMode') or brief->>'contentMode' in ('product','content')) is distinct from true
    or (coalesce(brief->>'contentMode','product') = 'content' and p_plan->>'scene' <> 'xhs-poster')
    or (p_plan->>'scene' = 'xhs-poster' and brief->>'platform' <> 'xiaohongshu') then
    raise exception using errcode='22023', message='invalid_commerce_brief';
  end if;
  if brief->>'contentMode' = 'content' and (brief->>'name' ~ '^[[:space:]]*$'
    or brief->>'facts' ~ '^[[:space:]]*$' or jsonb_array_length(brief->'productReferenceIds') <> 0) then
    raise exception using errcode='22023', message='commerce_brief_incomplete';
  end if;
  if jsonb_array_length(brief->'productReferenceIds') > 6 or jsonb_array_length(brief->'styleReferenceIds') > (case when p_plan->>'scene'='clone' then 20 else 8 end) then
    raise exception using errcode='22023', message='invalid_references';
  end if;
  perform value::uuid from jsonb_array_elements_text((brief->'productReferenceIds') || (brief->'styleReferenceIds'));
  slot_count := jsonb_array_length(p_plan->'slots');
  if slot_count not between 1 and (case when p_plan->>'scene'='product-main' then 4 when p_plan->>'scene'='detail' then case when exists(select 1 from jsonb_array_elements(p_plan->'slots') s where s->>'outputSpec' in ('desktop','mobile')) then 32 else 16 end when p_plan->>'scene' in ('product-set','clone') then 20 else 8 end) or jsonb_array_length(p_compiled) <> slot_count
    or (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(p_plan->'slots') s) <> slot_count
    or (select count(distinct (s->>'slotId')::uuid) from jsonb_array_elements(p_compiled) s) <> slot_count then
    raise exception using errcode='22023', message='invalid_commerce_slots';
  end if;
  for slot in select value from jsonb_array_elements(p_plan->'slots') loop
    if (jsonb_typeof(slot) = 'object' and char_length(slot->>'role') between 1 and 80
      and jsonb_typeof(slot->'instruction') = 'string' and char_length(slot->>'instruction') <= 2000
      and jsonb_typeof(slot->'exactText') = 'string' and char_length(slot->>'exactText') <= 1000
      and jsonb_typeof(slot->'referenceIds') = 'array'
      and (not (slot ? 'category') or slot->>'category' in ('white','selling','scene','other'))
      and (not (slot ? 'module') or slot->>'module' in ('品牌首屏','核心卖点','产品展示','使用场景','材质细节','功能介绍','规格参数','尺寸说明','结构拆解','使用步骤','适用人群','对比展示','包装内容','品牌故事','常见问题','购买提示'))
      and ((not (slot ? 'outputSpec') and not (slot ? 'targetWidth') and not (slot ? 'targetHeight'))
        or (p_plan->>'scene'='detail' and (
          (slot->>'outputSpec'='standard' and (slot->>'targetWidth')::integer=970 and (slot->>'targetHeight')::integer=600)
          or (slot->>'outputSpec'='desktop' and (slot->>'targetWidth')::integer=1464 and (slot->>'targetHeight')::integer=600)
          or (slot->>'outputSpec'='mobile' and (slot->>'targetWidth')::integer=600 and (slot->>'targetHeight')::integer=450))))
      and slot->>'aspectRatio' in ('1:1','3:4','4:3','9:16','16:9')
      and ((slot->>'provider' = 'gemini' and slot->>'model' = 'gemini-3-pro-image' and slot->>'resolution' in ('1K','2K'))
        or (slot->>'provider' = 'seedream' and slot->>'model' in ('seedream-5.0-flash','seedream-5.0-pro') and slot->>'resolution' = '2K'))) is distinct from true then
      raise exception using errcode='22023', message='invalid_commerce_slot';
    end if;
    if jsonb_array_length(slot->'referenceIds') > (case when slot->>'provider'='seedream' then 10 else 14 end) then
      raise exception using errcode='22023', message='invalid_references';
    end if;
    perform value::uuid from jsonb_array_elements_text(slot->'referenceIds');
    select c into compiled_slot from jsonb_array_elements(p_compiled) c where (c->>'slotId')::uuid = (slot->>'id')::uuid;
    if (jsonb_typeof(compiled_slot) = 'object'
      and char_length(btrim(compiled_slot->>'prompt')) between 1 and 8000
      and char_length(btrim(compiled_slot->>'hash')) between 1 and 128
      and char_length(compiled_slot->>'templateVersion') > 0
      and char_length(compiled_slot->>'compilerVersion') > 0
      and compiled_slot->>'provider' = slot->>'provider'
      and compiled_slot->>'model' = slot->>'model'
      and (compiled_slot->'config') - 'registryVersion' - 'targetWidth' - 'targetHeight' = jsonb_build_object('aspectRatio',slot->>'aspectRatio',
        'resolution',slot->>'resolution','count',1,'referenceIds',slot->'referenceIds')
      and coalesce((compiled_slot#>>'{config,targetWidth}')::integer,0) = coalesce((slot->>'targetWidth')::integer,0)
      and coalesce((compiled_slot#>>'{config,targetHeight}')::integer,0) = coalesce((slot->>'targetHeight')::integer,0)) is distinct from true then
      raise exception using errcode='22023', message='invalid_commerce_compiled';
    end if;
  end loop;
end;
$$;

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

  if p_provider='seedream' and (p_model not in ('seedream-5.0-flash','seedream-5.0-pro') or p_config->>'resolution'<>'2K') then
    raise exception using errcode='22023', message='seedream_upgrade_required';
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

-- Supabase PostgREST enforces safe updates. Scope operator changes to the
-- singleton row instead of disabling the guard or rewriting a deployed migration.
create or replace function public.credit_admin(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; prior jsonb; amount bigint; item jsonb; existing private.credit_operations%rowtype;
begin
 if length(btrim(coalesce(p_input->>'reason','')))<3 or length(btrim(coalesce(p_input->>'actor','')))<1 then raise exception 'credit_audit_reason_required'; end if;
 if p_input->>'action' not in ('grant','price','reconcile','activate','audit') then raise exception 'invalid_credit_admin_action'; end if;
 if p_input->>'action'='audit' then
  uid:=(p_input->>'userId')::uuid;if uid is null then raise exception 'invalid_credit_user';end if;
  return (select jsonb_build_object('wallet',to_jsonb(w),'ledgerAvailable',l.available,'ledgerFrozen',l.frozen,'ledgerSpent',l.spent,'consistent',w.available_minor=l.available and w.frozen_minor=l.frozen and w.spent_minor=l.spent,'pending',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'status',o.status,'amountMinor',o.amount_minor,'model',o.model,'createdAt',o.created_at)),'[]') from private.credit_operations o where o.user_id=uid and o.status not in ('succeeded','refunded'))) from private.credit_wallets w cross join lateral (select coalesce(sum(case when kind in ('grant','release') then amount_minor when kind='reserve' then -amount_minor else 0 end),0) as available,coalesce(sum(case when kind='reserve' then amount_minor when kind in ('capture','release') then -amount_minor else 0 end),0) as frozen,coalesce(sum(amount_minor) filter(where kind='capture'),0) as spent from private.credit_ledger where user_id=uid) l where w.user_id=uid);
 end if;
 if not coalesce((p_input->>'apply')::boolean,false) then
  return jsonb_build_object('dryRun',true,'proposed',p_input,'settings',(select to_jsonb(s) from private.credit_settings s),'walletBefore',(select to_jsonb(w) from private.credit_wallets w where user_id=(p_input->>'userId')::uuid),'availableAfterGrant',(select available_minor+(p_input->>'amountMinor')::bigint from private.credit_wallets where user_id=(p_input->>'userId')::uuid),'operation',(select to_jsonb(o) from private.credit_operations o where id=(p_input->>'operationId')::uuid));
 end if;
 if p_input->>'requestId' is null then raise exception 'credit_request_id_required'; end if;
 select input into prior from private.credit_admin_audit where request_id=(p_input->>'requestId')::uuid;
 if found then if prior<>p_input then raise exception 'idempotency_conflict'; end if;return jsonb_build_object('replayed',true); end if;
 if p_input->>'action'='grant' then
  uid:=(p_input->>'userId')::uuid;amount:=(p_input->>'amountMinor')::bigint;
  if amount is null or amount not between 1 and 100000000 then raise exception 'invalid_credit_amount'; end if;
  perform 1 from public.account_profiles where user_id=uid and status='active' for update;perform private.credit_wallet(uid);
  insert into private.credit_ledger(user_id,kind,amount_minor,business_key,reason) values(uid,'grant',amount,'admin:'||(p_input->>'requestId'),p_input->>'reason') on conflict do nothing;
  if found then update private.credit_wallets set available_minor=available_minor+amount where user_id=uid; end if;
 elsif p_input->>'action'='activate' then update private.credit_settings set enabled=(p_input->>'enabled')::boolean where singleton=true;
 elsif p_input->>'action'='price' then
  if coalesce(length(p_input->>'version'),0) not between 1 and 100 then raise exception 'invalid_credit_version'; end if;
  if jsonb_typeof(p_input->'prices') is distinct from 'array' or jsonb_array_length(p_input->'prices')<>(select jsonb_array_length(v.prices) from private.credit_price_versions v join private.credit_settings s on s.version=v.version where s.singleton) then raise exception 'invalid_credit_prices'; end if;
  for item in select value from jsonb_array_elements(p_input->'prices') loop
   if jsonb_typeof(item->'label') is distinct from 'string' or coalesce(length(item->>'label'),0) not between 1 and 100 or item->>'unitMinor' is null or jsonb_typeof(item->'unitMinor') is distinct from 'number' or (item->>'unitMinor') !~ '^[0-9]+$' or (item->>'unitMinor')::bigint not between 1 and 1000000 or not exists(select 1 from private.credit_price_versions v,jsonb_array_elements(v.prices) p where v.version=(select version from private.credit_settings where singleton) and (p-'unitMinor'-'label')=(item-'unitMinor'-'label')) then raise exception 'invalid_credit_prices'; end if;
  end loop;
  if (select count(distinct (p-'unitMinor'-'label')) from jsonb_array_elements(p_input->'prices') p)<>(select jsonb_array_length(v.prices) from private.credit_price_versions v join private.credit_settings s on s.version=v.version where s.singleton) then raise exception 'invalid_credit_prices'; end if;
  insert into private.credit_price_versions(version,prices) values(p_input->>'version',p_input->'prices');update private.credit_settings set version=p_input->>'version' where singleton=true;
 elsif p_input->>'action'='reconcile' then
  select * into existing from private.credit_operations where id=(p_input->>'operationId')::uuid;
  perform 1 from public.account_profiles where user_id=existing.user_id for update;
  select * into existing from private.credit_operations where id=(p_input->>'operationId')::uuid for update;
  if existing.id is null or existing.status not in ('needs_review','result','processing') or length(coalesce(p_input->>'evidence',''))<10 then raise exception 'credit_reconciliation_evidence_required'; end if;
  if p_input->>'outcome' not in ('succeeded','refunded') then raise exception 'invalid_credit_status'; end if;
  if existing.result is not null and p_input->>'outcome'='refunded' then raise exception 'credit_result_must_complete'; end if;
  if existing.operation in ('chat','optimize') and p_input->>'outcome'='succeeded' then
   if existing.result is null then
    if jsonb_typeof(p_input->'result') is distinct from 'object' or (existing.operation='chat' and coalesce(length(p_input#>>'{result,content}'),0) not between 1 and 64000) or (existing.operation='optimize' and coalesce(length(p_input#>>'{result,text}'),0) not between 1 and 6000) then raise exception 'credit_reconciliation_result_required'; end if;
    perform public.credit_dispatch(existing.user_id,'text_result',jsonb_build_object('requestId',substring(existing.business_key from 6),'result',p_input->'result'));
   end if;
   perform public.credit_dispatch(existing.user_id,'text_complete',jsonb_build_object('requestId',substring(existing.business_key from 6)));
  else perform private.credit_settle(existing.id,p_input->>'outcome',p_input->>'reason');end if;
 else raise exception 'invalid_credit_admin_action'; end if;
 insert into private.credit_admin_audit(request_id,input) values((p_input->>'requestId')::uuid,p_input);
 return jsonb_build_object('applied',true);
end $$;
