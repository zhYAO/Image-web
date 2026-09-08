-- Commerce is a planning aggregate over the existing, separately charged image
-- children. The old submission/worker RPCs deliberately remain unchanged.
create table public.commerce_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  archived boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index commerce_tasks_session_idx on public.commerce_tasks(session_id, created_at, id);
create index commerce_tasks_owner_idx on public.commerce_tasks(user_id);

create table public.commerce_revisions (
  task_id uuid not null references public.commerce_tasks(id) on delete cascade,
  revision integer not null check (revision > 0),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (task_id, revision)
);
-- Never expose executable prompts/configs through the Data API or task JSON.
create table private.commerce_compiled_slots (
  task_id uuid not null,
  revision integer not null,
  slot_id uuid not null,
  compiled jsonb not null check (jsonb_typeof(compiled) = 'object'),
  primary key (task_id, revision, slot_id),
  foreign key (task_id, revision) references public.commerce_revisions(task_id, revision) on delete cascade
);
create table public.commerce_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  revision integer not null,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, task_id),
  unique (task_id, request_id),
  foreign key (task_id, revision) references public.commerce_revisions(task_id, revision) on delete cascade
);
create table public.commerce_run_items (
  run_id uuid not null,
  task_id uuid not null,
  slot_id uuid not null,
  position integer not null check (position between 1 and 8),
  batch_id uuid not null unique references public.generation_batches(id) on delete cascade,
  generation_id uuid not null unique references public.generations(id) on delete cascade,
  compatibility_hash text not null,
  selection_version integer not null check (selection_version >= 0),
  parent_generation_id uuid references public.generations(id) on delete set null,
  primary key (run_id, slot_id),
  unique (run_id, position),
  foreign key (run_id, task_id) references public.commerce_runs(id, task_id) on delete cascade
);
create index commerce_run_items_slot_idx on public.commerce_run_items(task_id, slot_id);
create index commerce_run_items_parent_idx on public.commerce_run_items(parent_generation_id);
-- Keep empty/removed slot state too: removing/re-adding a slot must not reset the
-- manual-selection fence and allow an old in-flight result to win (ABA).
create table public.commerce_selections (
  task_id uuid not null references public.commerce_tasks(id) on delete cascade,
  slot_id uuid not null,
  generation_id uuid references public.generations(id) on delete set null,
  compatibility_hash text,
  selection_version integer not null default 0 check (selection_version >= 0),
  pending_generation_id uuid references public.generations(id) on delete set null,
  primary key (task_id, slot_id)
);
create index commerce_selections_generation_idx on public.commerce_selections(generation_id);
create index commerce_selections_pending_idx on public.commerce_selections(pending_generation_id);
create table public.commerce_exports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null,
  revision integer not null,
  created_at timestamptz not null default clock_timestamp(),
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  foreign key (task_id, revision) references public.commerce_revisions(task_id, revision) on delete cascade
);
create index commerce_exports_revision_idx on public.commerce_exports(task_id, revision);
create table private.commerce_operation_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('create','save','submit','select','export','archive','cancel')),
  request_id uuid not null,
  task_id uuid not null references public.commerce_tasks(id) on delete cascade,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, operation, request_id)
);
create index commerce_operation_results_task_idx on private.commerce_operation_results(task_id);

-- Read-only owner projections. Every write goes through the service-only RPC.
alter table public.commerce_tasks enable row level security;
revoke all on public.commerce_tasks from public, anon, authenticated, service_role;
grant select on public.commerce_tasks to authenticated;
create policy commerce_tasks_read_own on public.commerce_tasks for select to authenticated
using (user_id = (select public.require_verified_user_id()) and exists (
  select 1 from public.sessions s where s.id = session_id and s.status = 'active'
    and s.user_id = (select auth.uid())
));
do $$
declare relation_name text;
begin
  foreach relation_name in array array['commerce_revisions','commerce_runs','commerce_run_items','commerce_selections','commerce_exports'] loop
    execute format('alter table public.%I enable row level security', relation_name);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', relation_name);
    execute format('grant select on public.%I to authenticated', relation_name);
    execute format('create policy commerce_read_own on public.%I for select to authenticated using (exists (select 1 from public.commerce_tasks t where t.id = task_id))', relation_name);
  end loop;
end;
$$;
alter table private.commerce_compiled_slots enable row level security;
alter table private.commerce_operation_results enable row level security;
revoke all on private.commerce_compiled_slots, private.commerce_operation_results from public, anon, authenticated, service_role;

create function private.commerce_validate_plan(p_plan jsonb, p_compiled jsonb)
returns void language plpgsql set search_path = '' as $$
declare slot jsonb; compiled_slot jsonb; brief jsonb; slot_count integer;
begin
  if (jsonb_typeof(p_plan) = 'object'
    and p_plan->>'scene' in ('product-main','product-set','detail','social','style-reference','model')
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
    and brief->>'platform' in ('taobao','douyin','xiaohongshu')
    and jsonb_typeof(brief->'productReferenceIds') = 'array'
    and jsonb_typeof(brief->'styleReferenceIds') = 'array') is distinct from true then
    raise exception using errcode='22023', message='invalid_commerce_brief';
  end if;
  if jsonb_array_length(brief->'productReferenceIds') > 4 or jsonb_array_length(brief->'styleReferenceIds') > 4 then
    raise exception using errcode='22023', message='invalid_references';
  end if;
  perform value::uuid from jsonb_array_elements_text((brief->'productReferenceIds') || (brief->'styleReferenceIds'));
  slot_count := jsonb_array_length(p_plan->'slots');
  if slot_count not between 1 and 8 or jsonb_array_length(p_compiled) <> slot_count
    or (select count(distinct (s->>'id')::uuid) from jsonb_array_elements(p_plan->'slots') s) <> slot_count
    or (select count(distinct (s->>'slotId')::uuid) from jsonb_array_elements(p_compiled) s) <> slot_count then
    raise exception using errcode='22023', message='invalid_commerce_slots';
  end if;
  for slot in select value from jsonb_array_elements(p_plan->'slots') loop
    if (jsonb_typeof(slot) = 'object' and char_length(slot->>'role') between 1 and 80
      and jsonb_typeof(slot->'instruction') = 'string' and char_length(slot->>'instruction') <= 2000
      and jsonb_typeof(slot->'exactText') = 'string' and char_length(slot->>'exactText') <= 1000
      and jsonb_typeof(slot->'referenceIds') = 'array'
      and slot->>'aspectRatio' in ('1:1','3:4','4:3','9:16','16:9')
      and ((slot->>'provider' = 'gemini' and slot->>'model' = 'gemini-3-pro-image' and slot->>'resolution' in ('1K','2K'))
        or (slot->>'provider' = 'seedream' and slot->>'model' = 'seedream-4.5' and slot->>'resolution' = '2K'))) is distinct from true then
      raise exception using errcode='22023', message='invalid_commerce_slot';
    end if;
    if jsonb_array_length(slot->'referenceIds') > 4 then
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
      and (compiled_slot->'config') - 'registryVersion' = jsonb_build_object('aspectRatio',slot->>'aspectRatio',
        'resolution',slot->>'resolution','count',1,'referenceIds',slot->'referenceIds')) is distinct from true then
      raise exception using errcode='22023', message='invalid_commerce_compiled';
    end if;
  end loop;
end;
$$;

-- Caller holds account/session/task locks. Reconciliation on reads avoids taking
-- a task lock from a generation-worker trigger in the opposite lock order.
create function private.commerce_reconcile(p_task_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.commerce_selections s set generation_id = i.generation_id,
    compatibility_hash = i.compatibility_hash, pending_generation_id = null
  from public.commerce_tasks t, private.commerce_compiled_slots c,
    public.commerce_run_items i, public.generations g, public.generation_batches b
  where s.task_id = p_task_id and t.id = s.task_id
    and c.task_id = t.id and c.revision = t.revision and c.slot_id = s.slot_id
    and i.task_id = s.task_id and i.slot_id = s.slot_id and i.generation_id = s.pending_generation_id
    and i.selection_version = s.selection_version and i.compatibility_hash = c.compiled->>'hash'
    and g.id = i.generation_id and g.batch_id = i.batch_id and b.id = i.batch_id
    and b.user_id = t.user_id and b.session_id = t.session_id
    and g.status = 'succeeded' and g.asset_status = 'active' and g.asset_expires_at > clock_timestamp();
  if found then update public.commerce_tasks set updated_at = clock_timestamp() where id = p_task_id; end if;
end;
$$;

create function private.commerce_task_json(p_task_id uuid) returns jsonb
language sql set search_path = '' as $$
  select r.plan || jsonb_build_object(
    'id',t.id,'sessionId',t.session_id,'revision',t.revision,'createdAt',t.created_at,
    'updatedAt',t.updated_at,'archived',t.archived,
    'slotHashes',coalesce((select jsonb_object_agg(c.slot_id::text,c.compiled->>'hash')
      from private.commerce_compiled_slots c where c.task_id=t.id and c.revision=t.revision),'{}'::jsonb),
    'runs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',run.id,'revision',run.revision,'requestId',run.request_id,'createdAt',run.created_at,
      'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'slotId',i.slot_id,'batchId',i.batch_id,'generationId',i.generation_id,'status',g.status,
        'error',g.error_code,'expired',g.status='succeeded' and
          (g.asset_status is distinct from 'active' or coalesce(g.asset_expires_at <= clock_timestamp(),true)),
        'compatibilityHash',i.compatibility_hash,'selectionVersion',i.selection_version)) order by i.position)
        from public.commerce_run_items i join public.generations g on g.id=i.generation_id
        where i.run_id=run.id),'[]'::jsonb)) order by run.created_at,run.id)
      from public.commerce_runs run where run.task_id=t.id),'[]'::jsonb),
    'selections',coalesce((select jsonb_agg(jsonb_build_object('slotId',s.slot_id,'generationId',s.generation_id,
      'compatibilityHash',s.compatibility_hash,'version',s.selection_version) order by slot.ordinality)
      from public.commerce_selections s join jsonb_array_elements(r.plan->'slots') with ordinality slot(value,ordinality)
        on (slot.value->>'id')::uuid=s.slot_id
      where s.task_id=t.id and s.generation_id is not null),'[]'::jsonb))
  from public.commerce_tasks t join public.commerce_revisions r on r.task_id=t.id and r.revision=t.revision
  where t.id=p_task_id;
$$;

create function private.commerce_dispatch(
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
      if coalesce(cardinality(selected_ids),0) not between 1 and 8
        or cardinality(selected_ids) <> (select count(distinct x) from unnest(selected_ids) x)
        or exists(select 1 from unnest(selected_ids) x where not exists (
          select 1 from private.commerce_compiled_slots c where c.task_id=task.id and c.revision=task.revision and c.slot_id=x)) then
        raise exception using errcode='22023', message='invalid_commerce_slots';
      end if;
      recreate := coalesce((p_input->>'recreate')::boolean,false);
      product_ids := array(select value::uuid from jsonb_array_elements_text(plan#>'{brief,productReferenceIds}'));
      style_ids := array(select value::uuid from jsonb_array_elements_text(plan#>'{brief,styleReferenceIds}'));
      reference_ids := product_ids || style_ids;
      if cardinality(product_ids)=0 or btrim(plan#>>'{brief,name}')=''
        or (plan->>'scene'='style-reference' and cardinality(style_ids)=0) then
        raise exception using errcode='22023', message='commerce_brief_incomplete';
      end if;
      if cardinality(reference_ids)>4 or cardinality(reference_ids) <> (select count(distinct x) from unnest(reference_ids) x) then
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
        if not (slot_ids <@ reference_ids) or not (slot_ids && product_ids)
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
          parent_uuid,null,null,child_key,compiled_slot->>'hash',p_correlation_id);
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
      if jsonb_array_length(p_input->'selections') not between 1 and 8
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

-- Public invoker wrapper; only the service role can reach the private definer.
create function public.commerce_dispatch(
  p_user_id uuid, p_operation text, p_task_id uuid, p_input jsonb,
  p_request_hash text, p_compiled jsonb, p_correlation_id uuid
) returns jsonb language sql set search_path = '' as $$
  select private.commerce_dispatch(p_user_id,p_operation,p_task_id,p_input,p_request_hash,p_compiled,p_correlation_id);
$$;
revoke all on function private.commerce_validate_plan(jsonb,jsonb), private.commerce_reconcile(uuid),
  private.commerce_task_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid),
  public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid) from public, anon, authenticated, service_role;
grant execute on function private.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid),
  public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid) to service_role;
