-- Retained session history is independent of the four model-input references.
-- This migration does not alter commerce plans, generation journals or quotas.
alter table public.reference_uploads add column source_generation_id uuid;
alter table public.reference_uploads add column write_state text not null default 'ready'
  check (write_state in ('pending','ready'));
create index reference_uploads_source_idx on public.reference_uploads(session_id,source_generation_id)
  where source_generation_id is not null;

create or replace function private.validate_reference_upload()
returns trigger language plpgsql security definer set search_path='' as $$
declare session_owner uuid; active_count integer;
begin
  select user_id into session_owner from public.sessions
    where id=new.session_id and status='active' for update;
  if session_owner is null or session_owner<>new.user_id then
    raise exception using errcode='23514',message='reference owner must match an active session';
  end if;
  if (select auth.uid()) is not null and (select auth.uid())<>new.user_id then
    raise insufficient_privilege using message='reference owner does not match the authenticated user';
  end if;
  -- Pending metadata reserves capacity too, but is not an active model input.
  -- Recheck updates/reactivation/moves, excluding this row under the session lock.
  if new.status='active' or new.write_state='pending' then
    select count(*) into active_count from public.reference_uploads
      where session_id=new.session_id and id<>new.id and (status='active' or write_state='pending');
    if active_count>=64 then
      raise exception using errcode='23514',message='reference_capacity_64';
    end if;
  end if;
  return new;
end;
$$;

-- No foreign keys: account/session/reference deletion MUST NOT erase the only
-- evidence of an in-flight or late Storage write. Retain tombstones after remove.
create table private.reference_write_intents (
  reference_id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  task_id uuid,
  storage_path text not null unique,
  state text not null default 'pending' check (state in ('pending','ready','abandoned')),
  write_until timestamptz not null default clock_timestamp()+interval '10 minutes',
  cleanup_next_at timestamptz not null default clock_timestamp(),
  cleanup_token uuid,
  cleanup_until timestamptz,
  cleanup_attempts integer not null default 0,
  cleanup_error text,
  created_at timestamptz not null default clock_timestamp()
);
create index reference_write_intents_due_idx on private.reference_write_intents(cleanup_next_at);
alter table private.reference_write_intents enable row level security;
revoke all on private.reference_write_intents from public,anon,authenticated,service_role;
-- Existing refs also participate in the metadata sweep, including expired refs.
insert into private.reference_write_intents(reference_id,user_id,session_id,storage_path,state,write_until)
  select id,user_id,session_id,storage_path,'ready',clock_timestamp() from public.reference_uploads;

create table private.reference_promotion_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  task_id uuid not null references public.commerce_tasks(id) on delete cascade,
  generation_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  primary key(user_id,request_id)
);
create index reference_promotion_requests_expiry_idx on private.reference_promotion_requests(expires_at);
create index reference_promotion_requests_task_idx on private.reference_promotion_requests(task_id);
alter table private.reference_promotion_requests enable row level security;
revoke all on private.reference_promotion_requests from public,anon,authenticated,service_role;

-- Caller holds a per-user admission lock plus the live owner/session/task locks.
-- Bindings have a 24-hour idempotency window and a hard 256-row user bound.
-- Every new binding (including reuse) costs one committed write, with no upload
-- bytes. Existing-key download attempts also cost one write so failed decoding
-- cannot release its way around admission. Exact ready-result replay is free.
create function private.reference_bind_request(p_user_id uuid,p_task_id uuid,p_request_id uuid,p_generation_id uuid,p_download_attempt boolean)
returns void language plpgsql set search_path='' as $$
declare previous private.reference_promotion_requests%rowtype; business_key text;
begin
  select * into previous from private.reference_promotion_requests where user_id=p_user_id and request_id=p_request_id for update;
  if found and (previous.task_id<>p_task_id or previous.generation_id<>p_generation_id) then raise exception 'idempotency_conflict'; end if;
  if previous.request_id is not null and not p_download_attempt then return; end if;
  if previous.request_id is null and (select count(*) from private.reference_promotion_requests where user_id=p_user_id)>=256 then
    raise exception 'preview_quota_exceeded:promotion_bindings';
  end if;
  business_key:='reference-admission:'||gen_random_uuid();
  perform private.reserve_preview_usage(p_user_id,'session_update',0,false,business_key,gen_random_uuid());
  perform private.commit_preview_usage(p_user_id,business_key);
  if previous.request_id is null then
    insert into private.reference_promotion_requests(user_id,request_id,task_id,generation_id)
      values(p_user_id,p_request_id,p_task_id,p_generation_id);
  end if;
end;
$$;

-- Only reduce this attempt's reserved bytes to the validated actual length.
-- Never release/re-reserve: admission and upload count stay reserved throughout.
create function public.reconcile_reference_promotion_usage(p_user_id uuid,p_business_key text,p_correlation_id uuid,p_bytes bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_bytes is null or p_bytes not between 1 and 10485760 or p_business_key not like 'promotion:%' then
    raise exception 'invalid_promotion_usage';
  end if;
  update private.preview_usage_ledger set amount=p_bytes where user_id=p_user_id and business_key=p_business_key
    and correlation_id=p_correlation_id and operation='upload' and metric='upload_bytes' and state='reserved' and amount>=p_bytes;
  if not found then raise exception 'invalid_promotion_reservation'; end if;
  return true;
end;
$$;

create function private.reference_lock_owner(p_user_id uuid,p_session_id uuid)
returns void language plpgsql set search_path='' as $$
begin
  perform 1 from auth.users u where u.id=p_user_id and u.is_anonymous is false
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
  if not found then raise exception using errcode='42501',message='unauthorized'; end if;
  perform 1 from public.account_profiles a where a.user_id=p_user_id and a.status='active' for share;
  if not found then raise exception using errcode='42501',message='unauthorized'; end if;
  perform 1 from public.sessions s where s.id=p_session_id and s.user_id=p_user_id and s.status='active' for update;
  if not found then raise exception using errcode='42501',message='session_not_found'; end if;
end;
$$;

create function private.reference_result(p_reference public.reference_uploads)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',p_reference.id,'name',p_reference.original_filename,
    'mimeType',p_reference.mime_type,'size',p_reference.size_bytes);
$$;

-- Service-only generic protocol shared by ordinary uploads and promotion.
create function public.reference_write_intent(p_user_id uuid,p_reference_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reference_uploads%rowtype; w private.reference_write_intents%rowtype; session_uuid uuid;
begin
  if p_user_id is null or p_reference_id is null then raise exception 'invalid_reference_request'; end if;
  if p_operation='abandon' then
    -- Cleanup is allowed after account deletion. Never remove a ready reference
    -- on an ambiguous finalize response; its committed byte reservation remains.
    select * into w from private.reference_write_intents where reference_id=p_reference_id and user_id=p_user_id for update;
    if not found then raise exception 'reference_intent_not_found'; end if;
    if exists(select 1 from public.reference_uploads where id=p_reference_id and user_id=p_user_id
      and storage_path=w.storage_path and status='active' and write_state='ready') then
      return jsonb_build_object('remove',false);
    end if;
    update private.reference_write_intents set state='abandoned',write_until=clock_timestamp(),cleanup_next_at=clock_timestamp()
      where reference_id=p_reference_id;
    delete from public.reference_uploads where id=p_reference_id and user_id=p_user_id and write_state='pending';
    return jsonb_build_object('remove',true);
  end if;
  select session_id into session_uuid from public.reference_uploads where id=p_reference_id and user_id=p_user_id;
  perform private.reference_lock_owner(p_user_id,session_uuid);
  -- Finalization/cleanup serialize on the intent before touching reference rows.
  if p_operation='register' then
    select * into r from public.reference_uploads where id=p_reference_id and user_id=p_user_id and session_id=session_uuid;
    if not found or r.status<>'expired' or r.upload_expires_at<=clock_timestamp() then
      raise exception 'reference_not_found';
    end if;
    if r.storage_bucket<>'uploads' or r.storage_path not like p_user_id::text||'/'||session_uuid::text||'/references/'||r.id::text||'/%' then
      raise exception 'invalid_reference_path';
    end if;
    insert into private.reference_write_intents(reference_id,user_id,session_id,storage_path)
      values(r.id,r.user_id,r.session_id,r.storage_path) on conflict(reference_id) do nothing;
    select * into w from private.reference_write_intents where reference_id=p_reference_id for update;
    if w.user_id<>p_user_id or w.storage_path<>r.storage_path or w.state<>'pending' or w.write_until<=clock_timestamp() then
      raise exception 'reference_intent_conflict';
    end if;
    update public.reference_uploads set write_state='pending' where id=p_reference_id;
    return 'true'::jsonb;
  elsif p_operation='finalize' then
    select * into w from private.reference_write_intents where reference_id=p_reference_id and user_id=p_user_id for update;
    if not found or w.state='abandoned' or (w.state='pending' and w.write_until<=clock_timestamp())
      or w.cleanup_token is not null then raise exception 'reference_intent_expired'; end if;
    select * into r from public.reference_uploads where id=p_reference_id and user_id=p_user_id and session_id=session_uuid for update;
    if not found or r.storage_path<>w.storage_path or r.upload_expires_at<=clock_timestamp()
      or (r.write_state='ready' and r.status<>'active') then raise exception 'reference_expired'; end if;
    if w.task_id is not null and not exists(select 1 from public.commerce_tasks t
      join public.commerce_run_items i on i.task_id=t.id
      join public.generations g on g.id=i.generation_id
      join public.generation_batches b on b.id=g.batch_id
      where t.id=w.task_id and t.user_id=p_user_id and t.session_id=session_uuid
        and g.id=r.source_generation_id and b.user_id=p_user_id and b.session_id=session_uuid
        and g.status='succeeded' and g.asset_status='active' and g.asset_expires_at>clock_timestamp()) then
      raise exception 'source_expired';
    end if;
    if not exists(select 1 from storage.objects where bucket_id='uploads' and name=w.storage_path) then
      raise exception 'reference_object_not_found';
    end if;
    update public.reference_uploads set status='active',write_state='ready' where id=p_reference_id returning * into r;
    update private.reference_write_intents set state='ready' where reference_id=p_reference_id;
    return private.reference_result(r);
  end if;
  raise exception 'invalid_reference_operation';
end;
$$;

-- A null metadata argument performs authorization and request binding before the
-- server downloads bytes. A metadata argument atomically reserves the reference
-- and registers its intent after validation, before ANY object upload.
create function public.promote_commerce_reference(p_user_id uuid,p_task_id uuid,p_request_id uuid,p_generation_id uuid,p_metadata jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare task public.commerce_tasks%rowtype; g public.generations%rowtype;
  r public.reference_uploads%rowtype; previous private.reference_promotion_requests%rowtype;
  reference_uuid uuid; path text; extension text; source_size numeric;
begin
  if p_user_id is null or p_task_id is null or p_request_id is null or p_generation_id is null then
    raise exception 'invalid_promotion_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reference-admission-user:'||p_user_id,0));
  perform pg_advisory_xact_lock(hashtextextended('reference-promotion:'||p_user_id||':'||p_request_id,0));
  select * into task from public.commerce_tasks where id=p_task_id and user_id=p_user_id;
  if not found then raise exception using errcode='42501',message='task_not_found'; end if;
  perform private.reference_lock_owner(p_user_id,task.session_id);
  perform pg_advisory_xact_lock(hashtextextended('commerce-task:'||p_task_id,0));
  select * into task from public.commerce_tasks where id=p_task_id and user_id=p_user_id for update;
  if not found then raise exception using errcode='42501',message='task_not_found'; end if;
  delete from private.reference_promotion_requests where user_id=p_user_id and expires_at<=clock_timestamp();
  select * into previous from private.reference_promotion_requests where user_id=p_user_id and request_id=p_request_id for update;
  if found and (previous.task_id<>p_task_id or previous.generation_id<>p_generation_id) then
    raise exception using errcode='23505',message='idempotency_conflict';
  end if;
  select x.* into g from public.generations x join public.generation_batches b on b.id=x.batch_id
    join public.commerce_run_items i on i.generation_id=x.id and i.task_id=p_task_id
    where x.id=p_generation_id and b.user_id=p_user_id and b.session_id=task.session_id for share of x;
  if not found then raise exception using errcode='42501',message='source_not_found'; end if;
  if g.status<>'succeeded' then raise exception 'source_not_succeeded'; end if;
  if g.asset_status is distinct from 'active' or g.asset_expires_at is null or g.asset_expires_at<=clock_timestamp()
    or g.storage_bucket is distinct from 'generated' or g.storage_path is null then raise exception 'source_expired'; end if;
  select x.* into r from public.reference_uploads x where x.session_id=task.session_id and x.user_id=p_user_id
    and x.source_generation_id=p_generation_id and x.status='active' and x.write_state='ready'
    and x.upload_expires_at>clock_timestamp() order by x.created_at desc limit 1;
  if found then
    if not exists(select 1 from storage.objects where bucket_id='uploads' and name=r.storage_path) then raise exception 'reference_expired'; end if;
    perform private.reference_bind_request(p_user_id,p_task_id,p_request_id,p_generation_id,false);
    return jsonb_build_object('reference',private.reference_result(r));
  end if;
  if exists(select 1 from public.reference_uploads where session_id=task.session_id and user_id=p_user_id
    and source_generation_id=p_generation_id and write_state='pending') then raise exception 'reference_in_progress'; end if;
  if (select count(*) from public.reference_uploads where session_id=task.session_id and (status='active' or write_state='pending'))>=64 then
    raise exception 'reference_capacity_64';
  end if;
  -- Source size comes only from server-owned Storage metadata. Missing/invalid
  -- or oversized metadata fails closed before any full source download.
  select case when jsonb_typeof(o.metadata->'size')='number' then (o.metadata->>'size')::numeric end into source_size
    from storage.objects o where o.bucket_id='generated' and o.name=g.storage_path;
  if source_size is null or source_size not between 1 and 10485760 or source_size<>trunc(source_size) then raise exception 'invalid_source_size'; end if;
  perform private.reference_bind_request(p_user_id,p_task_id,p_request_id,p_generation_id,p_metadata is null);
  if p_metadata is null then return jsonb_build_object('sessionId',task.session_id,'storagePath',g.storage_path,'size',source_size::bigint); end if;
  if (jsonb_typeof(p_metadata)='object' and p_metadata->>'mimeType' in ('image/png','image/jpeg','image/webp')
    and (p_metadata->>'size')::bigint between 1 and least(10485760,source_size)
    and (p_metadata->>'width')::integer between 1 and 16384 and (p_metadata->>'height')::integer between 1 and 16384) is distinct from true then
    raise exception 'invalid_reference_metadata';
  end if;
  extension:=case p_metadata->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
  reference_uuid:=gen_random_uuid();
  path:=p_user_id::text||'/'||task.session_id::text||'/references/'||reference_uuid::text||'/reference.'||extension;
  insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height,
    source_generation_id,status,write_state)
    values(reference_uuid,p_user_id,task.session_id,path,'reference.'||extension,p_metadata->>'mimeType',(p_metadata->>'size')::bigint,
      (p_metadata->>'width')::integer,(p_metadata->>'height')::integer,p_generation_id,'expired','pending');
  perform public.reference_write_intent(p_user_id,reference_uuid,'register');
  update private.reference_write_intents set task_id=p_task_id where reference_id=reference_uuid;
  return jsonb_build_object('referenceId',reference_uuid,'storagePath',path);
end;
$$;

-- Move existing implementations intact; wrappers preserve their public ABI and
-- service-only grants. The generation journal stays generated-bucket-only.
alter function public.claim_cleanup_work() rename to claim_cleanup_work_before_reference_history;
alter function public.claim_cleanup_work_before_reference_history() set schema private;
alter function public.cleanup_worker_step(uuid,text,uuid,text,text) rename to cleanup_worker_step_before_reference_history;
alter function public.cleanup_worker_step_before_reference_history(uuid,text,uuid,text,text) set schema private;
revoke all on function private.claim_cleanup_work_before_reference_history(),
  private.cleanup_worker_step_before_reference_history(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;

create function public.claim_cleanup_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.reference_write_intents%rowtype; job jsonb;
begin
  -- Request bindings have no object-cleanup responsibility. Bound maintenance
  -- batches and SKIP LOCKED avoid interfering with active promotion requests.
  with expired as (
    select user_id,request_id from private.reference_promotion_requests where expires_at<=clock_timestamp()
      order by expires_at limit 200 for update skip locked
  ) delete from private.reference_promotion_requests r using expired e where r.user_id=e.user_id and r.request_id=e.request_id;
  select * into w from private.reference_write_intents x
    where x.cleanup_next_at<=clock_timestamp() and (x.cleanup_until is null or x.cleanup_until<=clock_timestamp())
      and not exists(select 1 from public.reference_uploads r join public.sessions s on s.id=r.session_id
        join public.account_profiles a on a.user_id=r.user_id
        where r.id=x.reference_id and r.user_id=x.user_id and r.session_id=x.session_id and r.storage_path=x.storage_path
          and s.status='active' and a.status='active' and r.upload_expires_at>clock_timestamp()
          and ((r.status='active' and r.write_state='ready') or (r.write_state='pending' and x.state='pending' and x.write_until>clock_timestamp())))
      and (x.state='pending' or exists(select 1 from storage.objects o where o.bucket_id='uploads' and o.name=x.storage_path))
    order by x.cleanup_next_at for update skip locked limit 1;
  if w.reference_id is not null then
    update private.reference_write_intents set state='abandoned',cleanup_token=gen_random_uuid(),cleanup_attempts=cleanup_attempts+1,
      cleanup_until=clock_timestamp()+interval '120 seconds' where reference_id=w.reference_id returning * into w;
    delete from public.reference_uploads where id=w.reference_id and write_state='pending';
    return jsonb_build_object('attempt',w.cleanup_attempts,'jobId',w.reference_id,'targetId',w.reference_id,'jobType','orphan_reference',
      'claimToken',w.cleanup_token,'objects',jsonb_build_array(jsonb_build_object('bucket','uploads','path',w.storage_path)));
  end if;
  job:=private.claim_cleanup_work_before_reference_history();
  return job;
end;
$$;

create function public.cleanup_worker_step(p_job_id uuid,p_job_type text,p_claim_token uuid,p_operation text,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.reference_write_intents%rowtype;
begin
  if p_job_type is distinct from 'orphan_reference' then
    return private.cleanup_worker_step_before_reference_history(p_job_id,p_job_type,p_claim_token,p_operation,p_error_code);
  end if;
  select * into w from private.reference_write_intents where reference_id=p_job_id for update;
  if not found or w.cleanup_token is null or w.cleanup_token is distinct from p_claim_token
    or w.cleanup_until is null or w.cleanup_until<=clock_timestamp() then
    return jsonb_build_object('accepted',false,'dead',false);
  end if;
  -- A stale worker cannot renew/delete a newly active object reference.
  if exists(select 1 from public.reference_uploads r join public.sessions s on s.id=r.session_id
    join public.account_profiles a on a.user_id=r.user_id
    where r.id=w.reference_id and r.storage_path=w.storage_path and s.status='active' and a.status='active'
    and r.status='active' and r.write_state='ready' and r.upload_expires_at>clock_timestamp()) then
    return jsonb_build_object('accepted',false,'dead',false);
  end if;
  if p_operation='renew' then
    update private.reference_write_intents set cleanup_until=clock_timestamp()+interval '120 seconds' where reference_id=p_job_id;
  elsif p_operation in ('complete','fail') then
    update private.reference_write_intents set cleanup_token=null,cleanup_until=null,
      cleanup_error=case when p_operation='fail' then 'reference_storage_cleanup_failed' else null end,
      cleanup_next_at=clock_timestamp()+make_interval(secs=>case when p_operation='complete' then 30
        else least(3600,30*power(2,least(w.cleanup_attempts,7))::integer) end)
      where reference_id=p_job_id;
  else raise exception 'invalid_cleanup_operation'; end if;
  return jsonb_build_object('accepted',true,'dead',false,'attempts',w.cleanup_attempts);
end;
$$;

revoke all on function private.reference_lock_owner(uuid,uuid),private.reference_result(public.reference_uploads)
  from public,anon,authenticated,service_role;
revoke all on function public.reference_write_intent(uuid,uuid,text),public.promote_commerce_reference(uuid,uuid,uuid,uuid,jsonb),
  public.claim_cleanup_work(),public.cleanup_worker_step(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reference_write_intent(uuid,uuid,text),public.promote_commerce_reference(uuid,uuid,uuid,uuid,jsonb),
  public.claim_cleanup_work(),public.cleanup_worker_step(uuid,text,uuid,text,text) to service_role;

revoke all on function private.reference_bind_request(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_reference_promotion_usage(uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.reconcile_reference_promotion_usage(uuid,text,uuid,bigint) to service_role;
