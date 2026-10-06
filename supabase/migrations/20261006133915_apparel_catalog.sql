-- Deterministic catalog revisions share commerce identity, but never create AI jobs or billing operations.
create table public.apparel_runs (
 id uuid primary key default gen_random_uuid(), task_id uuid not null, revision integer not null,
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 request_hash text not null, status text not null check(status in ('processing','succeeded','failed')),
 claim_token uuid not null default gen_random_uuid(), lease_until timestamptz,
 error text, created_at timestamptz not null default clock_timestamp(),
 unique(user_id,request_id), foreign key(task_id,revision) references public.commerce_revisions on delete cascade
);
create index apparel_runs_task_idx on public.apparel_runs(task_id,created_at);
create index apparel_runs_user_lease_idx on public.apparel_runs(user_id,lease_until) where status='processing';
create table public.apparel_assets (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.apparel_runs on delete cascade,
 claim_token uuid not null, name text not null, width integer not null check(width>0), height integer not null check(height>0),
 storage_path text not null unique, uploaded boolean not null default false, retired boolean not null default false,
 expires_at timestamptz not null default clock_timestamp()+interval '90 days',
 unique(run_id,claim_token,name)
);
create index apparel_assets_run_idx on public.apparel_assets(run_id);
create index apparel_assets_expiry_idx on public.apparel_assets(expires_at);
create table private.apparel_selections(task_id uuid primary key references public.commerce_tasks on delete cascade, run_id uuid not null references public.apparel_runs on delete cascade);
alter table public.apparel_runs enable row level security;
alter table public.apparel_assets enable row level security;
alter table private.apparel_selections enable row level security;
revoke all on public.apparel_runs,public.apparel_assets,private.apparel_selections from public,anon,authenticated,service_role;
grant select on public.apparel_runs,public.apparel_assets to authenticated;
create policy apparel_runs_read_own on public.apparel_runs for select to authenticated using(exists(select 1 from public.commerce_tasks t where t.id=task_id));
create policy apparel_assets_read_own on public.apparel_assets for select to authenticated using(exists(select 1 from public.apparel_runs r where r.id=run_id and r.status='succeeded' and r.claim_token=apparel_assets.claim_token) and uploaded and not retired and expires_at>clock_timestamp());

create table private.apparel_access_usage(user_id uuid references auth.users on delete cascade, minute timestamptz not null, count integer not null, primary key(user_id,minute));
alter table private.apparel_access_usage enable row level security;
revoke all on private.apparel_access_usage from public,anon,authenticated,service_role;

create function private.apparel_assets_json(p_run uuid) returns jsonb language sql set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind','layout','id',a.id,'name',a.name,'width',a.width,'height',a.height,'mimeType','image/jpeg','expiresAt',a.expires_at,'expired',a.retired or a.expires_at<=clock_timestamp()) order by a.name),'[]')
 from public.apparel_assets a join public.apparel_runs r on r.id=a.run_id where r.id=p_run and a.claim_token=r.claim_token and a.uploaded;
$$;
create function private.apparel_task_json(p_task uuid) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('id',t.id,'sessionId',t.session_id,'engine','apparel-catalog','revision',t.revision,'plan',v.plan,'createdAt',t.created_at,'updatedAt',t.updated_at,'archived',t.archived,'runs',
 coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',r.id,'requestId',r.request_id,'revision',r.revision,'status',r.status,'createdAt',r.created_at,'error',r.error,'assets',case when r.status='succeeded' then private.apparel_assets_json(r.id) else '[]'::jsonb end)) order by r.created_at) from public.apparel_runs r where r.task_id=t.id),'[]')) ||
 coalesce((select jsonb_build_object('selectedRunId',s.run_id) from private.apparel_selections s where s.task_id=t.id),'{}')
 from public.commerce_tasks t join public.commerce_revisions v on v.task_id=t.id and v.revision=t.revision where t.id=p_task;
$$;
create function private.apparel_validate(p_plan jsonb) returns void language plpgsql set search_path='' as $$
declare refs uuid[]; field text; crop numeric[];
begin
 if (p_plan->>'engine'='apparel-catalog' and p_plan->>'scene'='apparel-catalog' and p_plan->>'layoutVersion'='1.0.0'
 and not(p_plan ? 'slots') and jsonb_typeof(p_plan->'brief')='object' and jsonb_typeof(p_plan#>'{sources,mains}')='array'
 and jsonb_array_length(p_plan#>'{sources,mains}')=5 and jsonb_typeof(p_plan#>'{sources,displays}')='array'
 and jsonb_array_length(p_plan#>'{sources,displays}') between 1 and 20 and jsonb_typeof(p_plan->'fabricCrop')='array' and jsonb_array_length(p_plan->'fabricCrop')=4) is distinct from true then raise exception 'invalid_apparel_plan'; end if;
 foreach field in array array['name','color','composition','care','size','weightRecommendation','design','fabric'] loop
  if jsonb_typeof(p_plan->'brief'->field) is distinct from 'string' or char_length(btrim(p_plan->'brief'->>field)) not between 1 and 2000 then raise exception 'invalid_apparel_brief'; end if;
 end loop;
 foreach field in array array['length','chest','shoulder','sleeve'] loop
  if jsonb_typeof(p_plan#>'{brief,measurements}'->field) is distinct from 'string' or char_length(btrim(p_plan#>'{brief,measurements}'->>field)) not between 1 and 80 then raise exception 'invalid_apparel_measurements'; end if;
 end loop;
 select array_agg(value::numeric) into crop from jsonb_array_elements_text(p_plan->'fabricCrop');
 if not(crop[1]>=0 and crop[1]<crop[3] and crop[3]<=1 and crop[2]>=0 and crop[2]<crop[4] and crop[4]<=1) then raise exception 'invalid_apparel_crop'; end if;
 select array_agg(id::uuid) into refs from (select value as id from jsonb_array_elements_text(p_plan#>'{sources,mains}') union all select d->>'id' from jsonb_array_elements(p_plan#>'{sources,displays}') d union all select p_plan#>>'{sources,logo}') s;
 if cardinality(refs)<>(select count(distinct id) from unnest(refs) id) or array_position(refs,null) is not null then raise exception 'invalid_apparel_sources'; end if;
end;
$$;

create function public.apparel_dispatch(p_user_id uuid,p_operation text,p_task_id uuid,p_input jsonb,p_request_hash text,p_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.commerce_tasks%rowtype; run public.apparel_runs%rowtype; prior private.commerce_operation_results%rowtype;
 sid uuid; req uuid; plan jsonb; result jsonb; refs uuid[]; asset public.apparel_assets%rowtype; token uuid; expected integer;
begin
 if p_operation not in ('list','get','create','save','submit','select','export','sources','asset','register','uploaded','renew','complete','fail') or p_operation is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_apparel_request'; end if;
 perform 1 from auth.users u where u.id=p_user_id and not u.is_anonymous and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'unauthorized'; end if;
 perform 1 from public.account_profiles a where a.user_id=p_user_id and a.status='active' for share;
 if not found then raise exception 'unauthorized'; end if;
 -- Serialize execution admission per account, independently of AI quota and wallet locks.
 perform pg_advisory_xact_lock(hashtextextended('apparel-account:'||p_user_id,0));
 if p_operation in ('create','list') then sid:=(p_input->>'sessionId')::uuid;
 else
  select * into task from public.commerce_tasks t where t.id=p_task_id and t.user_id=p_user_id;
  if not found then raise exception 'task_not_found'; end if;
  sid:=task.session_id;
 end if;
 perform 1 from public.sessions s where s.id=sid and s.user_id=p_user_id and s.status='active' for update;
 if not found then raise exception 'session_not_found'; end if;
 if p_operation='list' then
  return (select coalesce(jsonb_agg(private.apparel_task_json(t.id) order by t.created_at),'[]') from public.commerce_tasks t join public.commerce_revisions v on v.task_id=t.id and v.revision=t.revision where t.user_id=p_user_id and t.session_id=sid and v.plan->>'engine'='apparel-catalog');
 end if;
 if p_operation<>'create' then
  select * into task from public.commerce_tasks t where t.id=p_task_id and t.user_id=p_user_id for update;
  select v.plan into plan from public.commerce_revisions v where v.task_id=task.id and v.revision=task.revision;
  if plan->>'engine' is distinct from 'apparel-catalog' then raise exception 'task_not_found'; end if;
 end if;
 if p_operation='get' then return private.apparel_task_json(task.id); end if;
 if p_operation in ('create','save','select','export') then
  req:=(p_input->>'requestId')::uuid;
  if req is null or p_request_hash is null then raise exception 'invalid_apparel_request'; end if;
  select * into prior from private.commerce_operation_results o where o.user_id=p_user_id and o.operation=p_operation and o.request_id=req;
  if found then
   if prior.request_hash<>p_request_hash or (p_operation<>'create' and prior.task_id<>p_task_id) or not exists(select 1 from public.commerce_tasks t where t.id=prior.task_id and t.session_id=sid) then raise exception 'idempotency_conflict'; end if;
   -- Exports are re-authorized below so a replay cannot resurrect expired assets.
   if p_operation<>'export' then return private.apparel_task_json(prior.task_id); end if;
  end if;
 end if;
 if p_operation in ('create','save') then
  if p_operation='save' and (task.revision<>(p_input->>'expectedRevision')::integer or task.archived) then raise exception 'revision_conflict'; end if;
  perform private.apparel_validate(p_input->'plan');
  perform private.reserve_preview_usage(p_user_id,'session_update',0,false,'apparel:'||p_operation||':'||req,p_correlation_id);
  if p_operation='create' then insert into public.commerce_tasks(user_id,session_id) values(p_user_id,sid) returning * into task;
  else update public.commerce_tasks set revision=revision+1,updated_at=clock_timestamp() where id=task.id returning * into task; end if;
  insert into public.commerce_revisions(task_id,revision,plan) values(task.id,task.revision,p_input->'plan');
  result:=private.apparel_task_json(task.id);
 elsif p_operation='submit' then
  req:=(p_input->>'requestId')::uuid; expected:=(p_input->>'revision')::integer;
  if req is null or expected is null or p_request_hash is null then raise exception 'invalid_apparel_request'; end if;
  select * into run from public.apparel_runs r where r.user_id=p_user_id and r.request_id=req for update;
  if found and (run.task_id<>task.id or run.revision<>expected or run.request_hash<>p_request_hash) then raise exception 'idempotency_conflict'; end if;
  if run.id is not null and (run.status='succeeded' or (run.status='processing' and run.lease_until>clock_timestamp())) then return jsonb_build_object('claimed',false,'task',private.apparel_task_json(task.id)); end if;
  if task.revision<>expected or task.archived then raise exception 'revision_conflict'; end if;
  if exists(select 1 from public.apparel_runs r where r.user_id=p_user_id and r.status='processing' and r.lease_until>clock_timestamp()) then raise exception 'apparel_account_busy'; end if;
  select array_agg(id::uuid) into refs from (select value as id from jsonb_array_elements_text(plan#>'{sources,mains}') union all select d->>'id' from jsonb_array_elements(plan#>'{sources,displays}') d union all select plan#>>'{sources,logo}') s;
  if (select count(*) from public.reference_uploads u where u.id=any(refs) and u.user_id=p_user_id and u.session_id=sid and u.status='active' and u.upload_expires_at>clock_timestamp())<>cardinality(refs) then raise exception 'reference_expired_or_forbidden'; end if;
  perform private.reserve_preview_usage(p_user_id,'session_update',0,false,'apparel:submit:'||req,p_correlation_id);
  if run.id is null then insert into public.apparel_runs(task_id,revision,user_id,request_id,request_hash,status,lease_until) values(task.id,expected,p_user_id,req,p_request_hash,'processing',clock_timestamp()+interval '120 seconds') returning * into run;
  else
   update public.apparel_assets set retired=true,expires_at=clock_timestamp()+interval '10 minutes' where run_id=run.id and not retired;
   update public.apparel_runs set status='processing',error=null,claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds' where id=run.id returning * into run;
  end if;
  return jsonb_build_object('claimed',true,'runId',run.id,'claimToken',run.claim_token,'plan',plan,'task',private.apparel_task_json(task.id));
 elsif p_operation in ('select','export','asset') then
  if p_operation='asset' then
   select * into asset from public.apparel_assets a where a.id=(p_input->>'assetId')::uuid;
   select * into run from public.apparel_runs r where r.id=asset.run_id and r.task_id=task.id;
   if run.id is null then raise exception 'asset_not_found'; end if;
   if run.status<>'succeeded' or asset.claim_token<>run.claim_token or not asset.uploaded or asset.retired or asset.expires_at<=clock_timestamp() then raise exception 'asset_expired'; end if;
   delete from private.apparel_access_usage where user_id=p_user_id and minute<clock_timestamp()-interval '1 day';
   insert into private.apparel_access_usage values(p_user_id,date_trunc('minute',clock_timestamp()),1) on conflict(user_id,minute) do update set count=apparel_access_usage.count+1;
   if (select count from private.apparel_access_usage where user_id=p_user_id and minute=date_trunc('minute',clock_timestamp()))>180 then raise exception 'apparel_access_quota'; end if;
   return jsonb_build_object('path',asset.storage_path,'name',asset.name);
  end if;
  select * into run from public.apparel_runs r where r.id=(p_input->>'runId')::uuid and r.task_id=task.id;
  if run.id is null then raise exception 'run_not_found'; end if;
  if task.revision<>(p_input->>'revision')::integer then raise exception 'revision_conflict'; end if;
  if run.status<>'succeeded' or exists(select 1 from public.apparel_assets a where a.run_id=run.id and a.claim_token=run.claim_token and (a.retired or a.expires_at<=clock_timestamp())) then raise exception 'asset_expired'; end if;
  perform private.reserve_preview_usage(p_user_id,'session_update',0,false,'apparel:'||p_operation||':'||req,p_correlation_id);
  if p_operation='select' then insert into private.apparel_selections values(task.id,run.id) on conflict(task_id) do update set run_id=excluded.run_id; result:=private.apparel_task_json(task.id);
  else result:=jsonb_build_object('runId',run.id,'items',private.apparel_assets_json(run.id)); if prior.request_id is not null then return result; end if; end if;
 else
  select * into run from public.apparel_runs r where r.id=(p_input->>'runId')::uuid and r.task_id=task.id for update;
  token:=(p_input->>'claimToken')::uuid;
  if run.id is null or run.claim_token is distinct from token or run.status<>'processing' or run.lease_until<=clock_timestamp() then raise exception 'apparel_lease_lost'; end if;
  if p_operation='sources' then
   select v.plan into plan from public.commerce_revisions v where v.task_id=task.id and v.revision=run.revision;
   select array_agg(id::uuid) into refs from (select value as id from jsonb_array_elements_text(plan#>'{sources,mains}') union all select d->>'id' from jsonb_array_elements(plan#>'{sources,displays}') d union all select plan#>>'{sources,logo}') s;
   return (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'path',u.storage_path)),'[]') from public.reference_uploads u where u.id=any(refs) and u.user_id=p_user_id and u.session_id=sid and u.status='active' and u.upload_expires_at>clock_timestamp());
  elsif p_operation='register' then
   if p_input->>'name' !~ '^(主图/[1-5]|images/详情2_(01|0[3-9]|[12][0-9]))\.jpg$' or (p_input->>'width')::integer not in (750,790) or (p_input->>'height')::integer not between 1 and 40000 then raise exception 'invalid_apparel_asset'; end if;
   insert into public.apparel_assets(run_id,claim_token,name,width,height,storage_path) values(run.id,token,p_input->>'name',(p_input->>'width')::integer,(p_input->>'height')::integer,p_user_id||'/'||sid||'/apparel/'||run.id||'/'||token||'/'||(p_input->>'name')) on conflict(run_id,claim_token,name) do nothing;
   select * into asset from public.apparel_assets a where a.run_id=run.id and a.claim_token=token and a.name=p_input->>'name';
   return jsonb_build_object('id',asset.id,'path',asset.storage_path);
  elsif p_operation='uploaded' then update public.apparel_assets set uploaded=true where id=(p_input->>'assetId')::uuid and run_id=run.id and claim_token=token; if not found then raise exception 'asset_not_found'; end if;
  elsif p_operation='complete' then
   select v.plan into plan from public.commerce_revisions v where v.task_id=task.id and v.revision=run.revision;
   if (select count(*) from public.apparel_assets a where a.run_id=run.id and a.claim_token=token and a.uploaded)<>10+jsonb_array_length(plan#>'{sources,displays}') then raise exception 'apparel_incomplete'; end if;
   update public.apparel_runs set status='succeeded',lease_until=null where id=run.id;
   -- A completed old revision must not silently replace the selected current set.
   if run.revision=task.revision then insert into private.apparel_selections values(task.id,run.id) on conflict(task_id) do update set run_id=excluded.run_id; end if;
   update public.commerce_tasks set updated_at=clock_timestamp() where id=task.id;
  elsif p_operation='fail' then
   update public.apparel_runs set status='failed',lease_until=null,error=left(p_input->>'error',500) where id=run.id;
   update public.apparel_assets set retired=true,expires_at=clock_timestamp()+interval '10 minutes' where run_id=run.id and claim_token=token;
  else update public.apparel_runs set lease_until=clock_timestamp()+interval '120 seconds' where id=run.id; end if;
  return private.apparel_task_json(task.id);
 end if;
 insert into private.commerce_operation_results(user_id,operation,request_id,task_id,request_hash,result) values(p_user_id,p_operation,req,task.id,p_request_hash,result);
 return result;
end;
$$;
revoke all on function private.apparel_assets_json(uuid),private.apparel_task_json(uuid),private.apparel_validate(jsonb),public.apparel_dispatch(uuid,text,uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apparel_dispatch(uuid,text,uuid,jsonb,text,uuid) to service_role;


-- AI routes omit deterministic tasks; cleanup includes successful and interrupted writes.
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
    if exists(select 1 from public.commerce_revisions v where v.task_id=task.id and v.revision=task.revision and v.plan->>'engine'='apparel-catalog') then raise exception 'task_not_found'; end if;
    session_uuid := task.session_id;
  end if;
  -- Match deletion/worker order (account -> session -> task -> generation).
  -- UPDATE avoids share-to-update conversion deadlocks in the old child RPC.
  perform 1 from public.sessions s where s.id=session_uuid and s.user_id=p_user_id and s.status='active' for update;
  if not found then raise exception using errcode='42501', message='session_not_found'; end if;
  if p_operation='list' then
    result := '[]'::jsonb;
    for task_uuid in select t.id from public.commerce_tasks t where t.user_id=p_user_id and t.session_id=session_uuid and exists(select 1 from public.commerce_revisions v where v.task_id=t.id and v.revision=t.revision and v.plan->>'engine' is distinct from 'apparel-catalog') order by t.created_at,t.id loop
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

alter table private.cleanup_jobs drop constraint cleanup_jobs_type_check;
alter table private.cleanup_jobs add constraint cleanup_jobs_type_check check(job_type in ('session_delete','generation_expiry','reference_expiry','apparel_expiry'));

create or replace function private.claim_cleanup_job()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.cleanup_jobs%rowtype;
  objects jsonb;
begin
  insert into private.cleanup_jobs(job_type,target_id)
  select 'apparel_expiry',a.id from public.apparel_assets a join public.apparel_runs r on r.id=a.run_id
    where a.expires_at<=clock_timestamp() or (r.status='processing' and r.lease_until+interval '10 minutes'<=clock_timestamp())
  on conflict(job_type,target_id) do nothing;
  insert into private.cleanup_jobs (job_type, target_id)
  select 'generation_expiry', id from public.generations
  where asset_status = 'active' and asset_expires_at <= timezone('utc', now())
  on conflict (job_type, target_id) do nothing;

  insert into private.cleanup_jobs (job_type, target_id)
  select 'reference_expiry', id from public.reference_uploads
  where status = 'active' and upload_expires_at <= timezone('utc', now())
  on conflict (job_type, target_id) do nothing;

  select * into target
  from private.cleanup_jobs
  where (
      status in ('pending', 'failed')
      or (status = 'processing' and updated_at <= timezone('utc', now()) - interval '5 minutes')
    )
    and attempts < 5
    and next_run_at <= timezone('utc', now())
  order by next_run_at, created_at
  for update skip locked
  limit 1;
  if target.id is null then return null; end if;

  update private.cleanup_jobs
  set status = 'processing', attempts = attempts + 1, error_code = null
  where id = target.id
  returning * into target;

  if target.job_type = 'session_delete' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into objects
    from (
      select jsonb_build_object('bucket', storage_bucket, 'path', storage_path) item
      from public.reference_uploads where session_id = target.target_id and status <> 'deleted'
      union all
      select jsonb_build_object('bucket', generations.storage_bucket, 'path', generations.storage_path)
      from public.generations
      join public.generation_batches on generation_batches.id = generations.batch_id
      where generation_batches.session_id = target.target_id and generations.storage_path is not null
      union all
      select jsonb_build_object('bucket','generated','path',a.storage_path) from public.apparel_assets a join public.apparel_runs r on r.id=a.run_id join public.commerce_tasks t on t.id=r.task_id where t.session_id=target.target_id
    ) paths;
  elsif target.job_type = 'apparel_expiry' then
    select coalesce(jsonb_agg(jsonb_build_object('bucket','generated','path',storage_path)),'[]') into objects from public.apparel_assets where id=target.target_id;
  elsif target.job_type = 'generation_expiry' then
    select coalesce(jsonb_agg(jsonb_build_object('bucket', storage_bucket, 'path', storage_path)), '[]'::jsonb)
    into objects from public.generations where id = target.target_id and storage_path is not null;
  else
    select coalesce(jsonb_agg(jsonb_build_object('bucket', storage_bucket, 'path', storage_path)), '[]'::jsonb)
    into objects from public.reference_uploads where id = target.target_id and status = 'active';
  end if;

  return jsonb_build_object(
    'attempt', target.attempts,
    'jobId', target.id,
    'jobType', target.job_type,
    'objects', objects,
    'targetId', target.target_id
  );
end;
$$;
create or replace function private.complete_cleanup_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.cleanup_jobs%rowtype;
begin
  perform 1 from private.cleanup_jobs where id=p_job_id for update;
  if exists(select 1 from private.cleanup_jobs where id=p_job_id and claim_token is not null
    and (claim_token::text is distinct from current_setting('zimage.cleanup_token',true) or lease_until<=clock_timestamp())) then
    raise exception 'cleanup_lease_lost';
  end if;
  select * into target from private.cleanup_jobs where id = p_job_id and status = 'processing' for update;
  if target.id is null then return false; end if;

  if target.job_type = 'session_delete' then
    if to_regclass('langgraph.checkpoints') is not null then
      execute 'delete from langgraph.checkpoint_writes where thread_id = $1' using target.target_id::text;
      execute 'delete from langgraph.checkpoint_blobs where thread_id = $1' using target.target_id::text;
      execute 'delete from langgraph.checkpoints where thread_id = $1' using target.target_id::text;
    end if;
    delete from public.sessions where id = target.target_id and status = 'deleting';
  elsif target.job_type = 'apparel_expiry' then
    update public.apparel_assets set retired=true where id=target.target_id;
  elsif target.job_type = 'generation_expiry' then
    update public.generations
    set asset_status = 'expired', storage_bucket = null, storage_path = null
    where id = target.target_id and asset_status = 'active';
  else
    update public.reference_uploads set status = 'expired'
    where id = target.target_id and status = 'active';
  end if;

  update private.cleanup_jobs set status = 'completed', error_code = null where id = target.id;
  return true;
end;
$$;
create or replace function public.claim_account_cleanup_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare target private.account_cleanup_jobs%rowtype; objects jsonb;
begin
  update private.account_cleanup_jobs set status='failed',error_code='cleanup_lease_exhausted',updated_at=clock_timestamp()
    where status='processing' and attempts>=5 and coalesce(lease_until,updated_at+interval '5 minutes')<=clock_timestamp();
  select * into target from private.account_cleanup_jobs
    where (status in ('pending','failed') or (status='processing' and coalesce(lease_until,updated_at+interval '5 minutes')<=clock_timestamp()))
      and attempts<5 and next_run_at<=clock_timestamp() order by next_run_at for update skip locked limit 1;
  if target.user_id is null then return null; end if;
  update private.account_cleanup_jobs set status='processing',attempts=attempts+1,updated_at=clock_timestamp(),
    claim_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',error_code=null
    where user_id=target.user_id returning * into target;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into objects from (
    select jsonb_build_object('bucket',storage_bucket,'path',storage_path) item from public.reference_uploads where user_id=target.user_id and status<>'deleted'
    union all
    select jsonb_build_object('bucket',g.storage_bucket,'path',g.storage_path) from public.generations g
      join public.generation_batches b on b.id=g.batch_id where b.user_id=target.user_id and g.storage_path is not null
    union all
    select jsonb_build_object('bucket','generated','path',storage_path) from private.generation_work where user_id=target.user_id and storage_path is not null
    union all
    select jsonb_build_object('bucket','generated','path',a.storage_path) from public.apparel_assets a join public.apparel_runs r on r.id=a.run_id where r.user_id=target.user_id
  ) paths;
  return jsonb_build_object('attempt',target.attempts,'jobId',target.user_id,'jobType','account_delete',
    'objects',objects,'targetId',target.user_id,'claimToken',target.claim_token);
end;
$$;
