-- Extend the existing versioned commerce task contract for ecommerce workflows.
-- Saved legacy plans retain their original shape; only new plan revisions use the added fields.
-- Preserve frozen compiled prompts, ownership checks and generation admission accounting.

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
        or (slot->>'provider' = 'seedream' and slot->>'model' = 'seedream-4.5' and slot->>'resolution' = '2K'))) is distinct from true then
      raise exception using errcode='22023', message='invalid_commerce_slot';
    end if;
    if jsonb_array_length(slot->'referenceIds') > 14 then
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

create table public.creative_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  request_id uuid not null,
  request_hash text not null,
  workflow text not null check (workflow in ('product-set','detail','clone')),
  global_params jsonb not null default '{}'::jsonb,
  items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 20),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id)
);
create index creative_batches_session_created_idx on public.creative_batches(session_id,created_at desc);
alter table public.creative_batches enable row level security;
create policy creative_batches_select_own on public.creative_batches for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.creative_batches from public, anon, authenticated;
grant select on public.creative_batches to authenticated;
grant all on public.creative_batches to service_role;

create or replace function private.commerce_dispatch(
  p_user_id uuid, p_operation text, p_task_id uuid, p_input jsonb,
  p_request_hash text, p_compiled jsonb, p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  task public.commerce_tasks%rowtype;
  previous private.commerce_operation_results%rowtype;
  selection public.commerce_selections%rowtype;
  candidate public.commerce_run_items%rowtype;
  session_uuid uuid; request_uuid uuid; task_uuid uuid; slot_uuid uuid; run_uuid uuid;
  batch_uuid uuid; generation_uuid uuid; parent_uuid uuid; export_uuid uuid;
  plan jsonb; compiled_slot jsonb; slot jsonb; result jsonb; child jsonb; manifest jsonb;
  reference_ids uuid[]; product_ids uuid[]; style_ids uuid[]; slot_ids uuid[]; selected_ids uuid[];
  expected_revision integer; item_position integer := 0; recreate boolean; created timestamptz;
  child_key text; planning_key text; guard_operation text; queued record;
begin
  if p_user_id is null or p_operation is null or p_operation not in ('list','get','create','save','submit','select','export','archive','cancel')
    or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023', message='invalid_commerce_request';
  end if;
  if p_operation not in ('list','get') then
    request_uuid := (p_input->>'requestId')::uuid;
    if request_uuid is null or p_correlation_id is null or coalesce(char_length(btrim(p_request_hash)),0) not between 1 and 128 then
      raise exception using errcode='22023', message='invalid_commerce_request';
    end if;
    -- Request lock precedes task lock; a retry waits for the original result.
    perform pg_advisory_xact_lock(hashtextextended('commerce-request:'||p_user_id||':'||request_uuid,0));
  end if;
  -- Service role is authenticated by the server. Check live account facts here,
  -- not its service JWT (which intentionally has no end-user auth.session_id).
  perform 1 from auth.users u where u.id=p_user_id and u.is_anonymous is false
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= clock_timestamp()) for share;
  if not found then raise exception using errcode='42501', message='unauthorized'; end if;
  perform 1 from public.account_profiles a where a.user_id=p_user_id and a.status='active' for share;
  if not found then raise exception using errcode='42501', message='unauthorized'; end if;
  if p_operation in ('create','list') then
    if p_task_id is not null then raise exception using errcode='22023', message='invalid_commerce_request'; end if;
    session_uuid := (p_input->>'sessionId')::uuid;
  else
    select * into task from public.commerce_tasks t where t.id=p_task_id and t.user_id=p_user_id;
    if not found then raise exception using errcode='42501', message='task_not_found'; end if;
    session_uuid := task.session_id;
  end if;
  -- Match deletion/worker order (account -> session -> task -> generation).
  -- UPDATE avoids share-to-update conversion deadlocks in the old child RPC.
  perform 1 from public.sessions s where s.id=session_uuid and s.user_id=p_user_id and s.status='active' for update;
  if not found then raise exception using errcode='42501', message='session_not_found'; end if;
  if p_operation='list' then
    result := '[]'::jsonb;
    for task_uuid in select t.id from public.commerce_tasks t where t.user_id=p_user_id and t.session_id=session_uuid order by t.created_at,t.id loop
      perform pg_advisory_xact_lock(hashtextextended('commerce-task:'||task_uuid,0));
      perform private.commerce_reconcile(task_uuid);
      result := result || jsonb_build_array(private.commerce_task_json(task_uuid));
    end loop;
    return result;
  end if;
  if p_operation <> 'create' then
    perform pg_advisory_xact_lock(hashtextextended('commerce-task:'||p_task_id,0));
    select * into task from public.commerce_tasks t where t.id=p_task_id and t.user_id=p_user_id for update;
    if not found then raise exception using errcode='42501', message='task_not_found'; end if;
  end if;
  if p_operation <> 'get' then
    select * into previous from private.commerce_operation_results o
      where o.user_id=p_user_id and o.operation=p_operation and o.request_id=request_uuid;
    if found then
      if previous.request_hash is distinct from p_request_hash
        or (p_operation <> 'create' and previous.task_id is distinct from p_task_id)
        or not exists (select 1 from public.commerce_tasks t where t.id=previous.task_id
          and t.user_id=p_user_id and t.session_id=session_uuid) then
        raise exception using errcode='23505', message='idempotency_conflict';
      end if;
      return previous.result;
    end if;
  end if;
  -- Same RPC, read preflight: SQL NULL is distinct from a JSON null or [].
  -- The service can recover a committed create/save before consulting today's
  -- template/model registry. A miss must not reconcile, spend, or validate a
  -- proposed revision/plan. The compiled second call repeats all authorization
  -- and idempotency checks under the same locks.
  if p_operation in ('create','save') and p_compiled is null then return null; end if;
  if p_operation <> 'create' then
    if p_operation='get' then
      perform private.commerce_reconcile(p_task_id);
      return private.commerce_task_json(p_task_id);
    end if;
    expected_revision := (case when p_operation='save' then p_input->>'expectedRevision' else p_input->>'revision' end)::integer;
    if expected_revision is null or expected_revision < 1 then
      raise exception using errcode='22023', message='invalid_commerce_revision';
    end if;
    if expected_revision <> task.revision then raise exception using errcode='40001', message='revision_conflict'; end if;
    if task.archived and p_operation in ('save','submit') then
      raise exception using errcode='P0001', message='task_archived';
    end if;
  end if;

  if p_operation in ('create','save','select','export','archive','cancel') then
    -- One generic session write, no new session and no image-quota units.
    -- SUBMIT stays child-only: its per-child guards already meter every write.
    planning_key := 'commerce:'||p_operation||':'||request_uuid;
    perform private.reserve_preview_usage(p_user_id,'session_update',0,false,planning_key,p_correlation_id);
  end if;
  if p_operation <> 'create' then perform private.commerce_reconcile(p_task_id); end if;

  if p_operation in ('create','save') then
    plan := p_input->'plan';
    perform private.commerce_validate_plan(plan,p_compiled);
    if p_operation='create' then
      insert into public.commerce_tasks(user_id,session_id) values(p_user_id,session_uuid) returning * into task;
    else
      update public.commerce_tasks set revision=revision+1,updated_at=clock_timestamp() where id=p_task_id returning * into task;
    end if;
    insert into public.commerce_revisions(task_id,revision,plan) values(task.id,task.revision,plan);
    insert into private.commerce_compiled_slots(task_id,revision,slot_id,compiled)
      select task.id,task.revision,(c->>'slotId')::uuid,c from jsonb_array_elements(p_compiled) c;
    insert into public.commerce_selections(task_id,slot_id)
      select task.id,(s->>'id')::uuid from jsonb_array_elements(plan->'slots') s on conflict do nothing;
    -- Inherit unchanged slots, including pending candidates. Invalidate the
    -- pending pointer when its hash changes or its slot is removed.
    update public.commerce_selections s set pending_generation_id=null
      where s.task_id=task.id and s.pending_generation_id is not null and not exists (
        select 1 from public.commerce_run_items i join private.commerce_compiled_slots c
          on c.task_id=i.task_id and c.slot_id=i.slot_id and c.revision=task.revision
        where i.generation_id=s.pending_generation_id and i.compatibility_hash=c.compiled->>'hash');
  else
    select r.plan into plan from public.commerce_revisions r where r.task_id=task.id and r.revision=task.revision;
    if p_operation='submit' then
      if jsonb_typeof(p_input->'slotIds') is distinct from 'array'
        or (p_input ? 'recreate' and jsonb_typeof(p_input->'recreate') <> 'boolean')
        or coalesce(p_input->>'source','direct') not in ('direct','chat_tool') then
        raise exception using errcode='22023', message='invalid_commerce_submit';
      end if;
      select array_agg(value::uuid) into selected_ids from jsonb_array_elements_text(p_input->'slotIds');
      if coalesce(cardinality(selected_ids),0) not between 1 and 32
        or cardinality(selected_ids) <> (select count(distinct x) from unnest(selected_ids) x)
        or exists(select 1 from unnest(selected_ids) x where not exists (
          select 1 from private.commerce_compiled_slots c where c.task_id=task.id and c.revision=task.revision and c.slot_id=x)) then
        raise exception using errcode='22023', message='invalid_commerce_slots';
      end if;
      recreate := coalesce((p_input->>'recreate')::boolean,false);
      product_ids := array(select value::uuid from jsonb_array_elements_text(plan#>'{brief,productReferenceIds}'));
      style_ids := array(select value::uuid from jsonb_array_elements_text(plan#>'{brief,styleReferenceIds}'));
      reference_ids := product_ids || style_ids;
      if (coalesce(plan#>>'{brief,contentMode}','product') = 'content' and (
          plan->>'scene' <> 'xhs-poster' or plan#>>'{brief,platform}' <> 'xiaohongshu'
          or cardinality(product_ids) <> 0 or coalesce(plan#>>'{brief,facts}','') ~ '^[[:space:]]*$'))
        or (coalesce(plan#>>'{brief,contentMode}','product') <> 'content' and plan->>'scene'<>'clone' and cardinality(product_ids)=0)
        or btrim(plan#>>'{brief,name}')=''
        or (plan->>'scene' in ('style-reference','clone') and cardinality(style_ids)=0) then
        raise exception using errcode='22023', message='commerce_brief_incomplete';
      end if;
      if cardinality(product_ids)>6 or cardinality(style_ids)>(case when plan->>'scene'='clone' then 20 else 8 end) or cardinality(reference_ids) <> (select count(distinct x) from unnest(reference_ids) x) then
        raise exception using errcode='22023', message='invalid_references';
      end if;
      -- Lock actual uploads so deletion/expiry updates cannot pass validation
      -- and invalidate them before all children have been enqueued.
      perform 1 from public.reference_uploads r where r.id=any(reference_ids) order by r.id for share;
      if (select count(*) from public.reference_uploads r where r.id=any(reference_ids)
        and r.user_id=p_user_id and r.session_id=session_uuid and r.status='active'
        and r.upload_expires_at>clock_timestamp()) <> cardinality(reference_ids) then
        raise exception using errcode='22023', message='reference_expired_or_forbidden';
      end if;
      if not coalesce((select enabled from private.runtime_flags where flag='generation_enabled'),false) then
        raise exception using errcode='P0001', message='feature_disabled:generation';
      end if;
      -- Preflight every child; per-child guards below are still authoritative
      -- and a later quota/queue error rolls back the entire invocation.
      foreach slot_uuid in array selected_ids loop
        select c.compiled into compiled_slot from private.commerce_compiled_slots c
          where c.task_id=task.id and c.revision=task.revision and c.slot_id=slot_uuid;
        slot_ids := array(select value::uuid from jsonb_array_elements_text(compiled_slot#>'{config,referenceIds}'));
        if not (slot_ids <@ reference_ids)
          or (coalesce(plan#>>'{brief,contentMode}','product') <> 'content' and plan->>'scene'<>'clone' and not (slot_ids && product_ids))
          or (plan->>'scene'='clone' and (select count(*) from unnest(slot_ids) id where id=any(style_ids)) <> 1)
          or cardinality(slot_ids) <> (select count(distinct x) from unnest(slot_ids) x) then
          raise exception using errcode='22023', message='invalid_references';
        end if;
        if not coalesce((select enabled from private.provider_runtime_config where provider=compiled_slot->>'provider'),false) then
          raise exception using errcode='P0001', message='provider_unavailable';
        end if;
        if exists(select 1 from public.commerce_run_items i join public.generations g on g.id=i.generation_id
          left join private.generation_work w on w.generation_id=g.id
          where i.task_id=task.id and i.slot_id=slot_uuid and (
            g.status in ('pending','processing') or (g.status <> 'succeeded' and (
              g.provider_submission_state='unknown' or w.phase in ('claimed','submitted','result','uploaded','unknown')
              or g.error_code in ('provider_reconciliation_required','result_storage_failed','storage_error','storage_pending','result_pending_storage'))))) then
          raise exception using errcode='40001', message='commerce_slot_active';
        end if;
        if not recreate and exists(select 1 from public.commerce_run_items i
          join public.commerce_runs r on r.id=i.run_id join public.generations g on g.id=i.generation_id
          where i.task_id=task.id and i.slot_id=slot_uuid and g.status='succeeded'
            and (r.revision=task.revision or i.compatibility_hash=compiled_slot->>'hash')) then
          raise exception using errcode='40001', message='commerce_recreate_required';
        end if;
      end loop;
      insert into public.commerce_runs(task_id,revision,request_id) values(task.id,task.revision,request_uuid) returning id into run_uuid;
      foreach slot_uuid in array selected_ids loop
        item_position := item_position+1;
        select c.compiled into compiled_slot from private.commerce_compiled_slots c
          where c.task_id=task.id and c.revision=task.revision and c.slot_id=slot_uuid;
        select * into selection from public.commerce_selections s where s.task_id=task.id and s.slot_id=slot_uuid;
        parent_uuid := null;
        if recreate then
          select i.batch_id into parent_uuid from public.commerce_run_items i
            join public.commerce_runs r on r.id=i.run_id where i.task_id=task.id and i.slot_id=slot_uuid
            order by r.created_at desc,r.id desc limit 1;
        end if;
        child_key := run_uuid::text||':'||slot_uuid::text;
        guard_operation := case when recreate then 'generation_recreate' else 'generation' end;
        perform private.reserve_preview_usage(p_user_id,guard_operation,0,false,child_key,p_correlation_id);
        child := private.submit_image_generation(p_user_id,session_uuid,compiled_slot->>'prompt',
          compiled_slot->>'provider',compiled_slot->>'model',compiled_slot->'config',coalesce(p_input->>'source','direct'),
          parent_uuid,'commerce','2',child_key,compiled_slot->>'hash',p_correlation_id);
        batch_uuid := (child->>'batchId')::uuid;
        select g.id into strict generation_uuid from public.generations g where g.batch_id=batch_uuid;
        insert into public.commerce_run_items(run_id,task_id,slot_id,position,batch_id,generation_id,compatibility_hash,selection_version,parent_generation_id)
          values(run_uuid,task.id,slot_uuid,item_position,batch_uuid,generation_uuid,compiled_slot->>'hash',selection.selection_version,selection.generation_id);
        update public.commerce_selections set pending_generation_id=generation_uuid where task_id=task.id and slot_id=slot_uuid;
        if not private.commit_preview_usage(p_user_id,child_key) then
          raise exception using errcode='P0001', message='commerce_preview_commit_failed';
        end if;
      end loop;
    elsif p_operation='select' then
      slot_uuid := (p_input->>'slotId')::uuid;
      generation_uuid := (p_input->>'generationId')::uuid;
      select * into selection from public.commerce_selections s where s.task_id=task.id and s.slot_id=slot_uuid;
      if not found or not exists(select 1 from private.commerce_compiled_slots c where c.task_id=task.id and c.revision=task.revision and c.slot_id=slot_uuid) then
        raise exception using errcode='22023', message='invalid_commerce_slot';
      end if;
      if (p_input->>'expectedSelectionVersion')::integer is distinct from selection.selection_version then
        raise exception using errcode='40001', message='selection_conflict';
      end if;
      select i.* into candidate from public.commerce_run_items i join public.generations g on g.id=i.generation_id
        join public.generation_batches b on b.id=i.batch_id
        where i.task_id=task.id and i.slot_id=slot_uuid and i.generation_id=generation_uuid
          and g.batch_id=b.id and b.user_id=p_user_id and b.session_id=session_uuid
          and g.status='succeeded' and g.asset_status='active' and g.asset_expires_at>clock_timestamp() for share of g;
      if not found then raise exception using errcode='22023', message='commerce_generation_unavailable'; end if;
      -- Explicit selection can choose an older incompatible image; its actual
      -- hash is returned, so it is never represented as satisfying the new plan.
      update public.commerce_selections set generation_id=generation_uuid,compatibility_hash=candidate.compatibility_hash,
        selection_version=selection_version+1,pending_generation_id=null where task_id=task.id and slot_id=slot_uuid;
    elsif p_operation='export' then
      if jsonb_typeof(p_input->'selections') is distinct from 'array' then
        raise exception using errcode='22023', message='invalid_commerce_export';
      end if;
      if jsonb_array_length(p_input->'selections') not between 1 and 32
        or (select count(distinct (s->>'slotId')::uuid) from jsonb_array_elements(p_input->'selections') s) <> jsonb_array_length(p_input->'selections') then
        raise exception using errcode='22023', message='invalid_commerce_export';
      end if;
      manifest := '[]'::jsonb;
      for slot in select value from jsonb_array_elements(p_input->'selections') loop
        slot_uuid := (slot->>'slotId')::uuid; generation_uuid := (slot->>'generationId')::uuid;
        perform 1 from public.commerce_run_items i join public.generations g on g.id=i.generation_id
          join public.generation_batches b on b.id=i.batch_id
          join private.commerce_compiled_slots c on c.task_id=i.task_id and c.slot_id=i.slot_id and c.revision=task.revision
          where i.task_id=task.id and i.slot_id=slot_uuid and i.generation_id=generation_uuid
            and g.batch_id=b.id and b.user_id=p_user_id and b.session_id=session_uuid
            and g.status='succeeded' and g.asset_status='active' and g.asset_expires_at>clock_timestamp() for share of g;
        if not found then raise exception using errcode='22023', message='commerce_generation_unavailable'; end if;
        manifest := manifest || jsonb_build_array(jsonb_build_object('slotId',slot_uuid,'generationId',generation_uuid));
      end loop;
      insert into public.commerce_exports(task_id,revision,items) values(task.id,task.revision,manifest) returning id,created_at into export_uuid,created;
      result := jsonb_build_object('id',export_uuid,'revision',task.revision,'createdAt',created,'items',manifest);
    elsif p_operation='cancel' then
      run_uuid := (p_input->>'runId')::uuid;
      if not exists(select 1 from public.commerce_runs r where r.id=run_uuid and r.task_id=task.id) then
        raise exception using errcode='22023', message='commerce_run_not_found';
      end if;
      -- The session lock coordinates with worker/deletion fencing. Only lock
      -- cancellable pending children; processing claims are left untouched,
      -- even when the provider has not been called yet. Other runs are untouched.
      for candidate in select i.* from public.commerce_run_items i
        join public.generations g on g.id=i.generation_id
        left join private.generation_work w on w.generation_id=g.id
        where i.run_id=run_uuid and g.status='pending' and g.provider_submission_state='not_submitted'
          and (w.generation_id is null or w.phase in ('claimed','cancelled'))
        order by g.id for update of g loop
        item_position := item_position+1;
        -- Explicit release/archive follows the existing ledger business key.
        -- fail_image_generation requires a worker lease and records a provider
        -- error; user cancellation must neither forge that lease nor penalize
        -- provider health. No worker can cross our account/session/generation locks.
        update public.generations set status='failed',error_code='user_cancelled' where id=candidate.generation_id;
        update private.generation_work set phase='cancelled',result=null,updated_at=clock_timestamp()
          where generation_id=candidate.generation_id;
        -- created_at is the ledger accounting bucket, not the cancellation
        -- event time. Never credit today's quota for yesterday's reservation.
        -- Generation/task/operation-result timestamps retain actual event time.
        insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key,created_at)
          select p_user_id,candidate.batch_id,candidate.generation_id,'release',1,'release:'||candidate.generation_id,q.created_at
          from private.quota_ledger q where q.user_id=p_user_id and q.entry_type='reserve'
            and q.business_key='reserve:'||candidate.generation_id
          on conflict(business_key) do nothing;
        for queued in select q.msg_id from pgmq.q_image_generation q
          where q.message->>'generationId'=candidate.generation_id::text loop
          perform pgmq.archive('image_generation',queued.msg_id);
        end loop;
        perform private.refresh_generation_batch(candidate.batch_id);
        update public.commerce_selections set pending_generation_id=null
          where task_id=task.id and pending_generation_id=candidate.generation_id;
      end loop;
      if item_position=0 then raise exception using errcode='40001', message='commerce_cancel_conflict'; end if;
    elsif p_operation='archive' then
      update public.commerce_tasks set archived=true where id=task.id;
    end if;
    update public.commerce_tasks set updated_at=clock_timestamp() where id=task.id;
  end if;
  if planning_key is not null and not private.commit_preview_usage(p_user_id,planning_key) then
    raise exception using errcode='P0001', message='commerce_preview_commit_failed';
  end if;
  if p_operation <> 'export' then result := private.commerce_task_json(task.id); end if;
  insert into private.commerce_operation_results(user_id,operation,request_id,task_id,request_hash,result)
    values(p_user_id,p_operation,request_uuid,task.id,p_request_hash,result);
  return result;
end;
$$;

-- Commerce uses one image per child. Ordinary image requests still have the four-reference limit.
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
      or jsonb_array_length(p_config -> 'referenceIds') > (case when p_skill_id='commerce' then 14 else 4 end) then
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

-- Paid ecommerce batches need room for more child writes and image uploads.
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
  if current_write_count + 1 > (case when coalesce((select enabled from private.credit_settings where singleton),false) then 1000 else 60 end) then
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
    if current_upload_count + 1 > (case when coalesce((select enabled from private.credit_settings where singleton),false) then 64 else 10 end)
      or current_upload_bytes + p_bytes > (case when coalesce((select enabled from private.credit_settings where singleton),false) then 640 else 50 end) * 1024 * 1024 then
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
