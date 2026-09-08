-- Content deletion must not refund consumption. Keep immutable business identities
-- alongside nullable navigation FKs; auth-user deletion retains its existing policy.
alter table private.quota_ledger
  drop constraint quota_ledger_batch_id_fkey,
  drop constraint quota_ledger_generation_id_fkey,
  drop constraint quota_ledger_target_check,
  add column original_batch_id uuid,
  add column original_generation_id uuid;
update private.quota_ledger set original_batch_id=batch_id, original_generation_id=generation_id;
-- created_at is the accounting bucket for releases, not the cancellation time.
-- Repair existing identifiable refunds before installing immutable identities.
update private.quota_ledger released set created_at=reserved.created_at
from private.quota_ledger reserved
where released.entry_type='release' and reserved.entry_type='reserve'
  and released.user_id=reserved.user_id and released.original_generation_id=reserved.original_generation_id;
alter table private.quota_ledger
  add foreign key (batch_id) references public.generation_batches(id) on delete set null,
  add foreign key (generation_id) references public.generations(id) on delete set null,
  add constraint quota_ledger_target_check check (original_batch_id is not null or original_generation_id is not null);
create function private.preserve_quota_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.original_batch_id := coalesce(new.original_batch_id,new.batch_id);
    new.original_generation_id := coalesce(new.original_generation_id,new.generation_id);
    if new.entry_type='release' then
      select created_at into new.created_at from private.quota_ledger
        where entry_type='reserve' and user_id=new.user_id and original_generation_id=new.original_generation_id;
      if not found then raise exception 'quota_reservation_not_found'; end if;
    end if;
  elsif new.original_batch_id is distinct from old.original_batch_id
    or new.original_generation_id is distinct from old.original_generation_id
    or new.business_key is distinct from old.business_key
    or new.user_id is distinct from old.user_id
    or new.entry_type is distinct from old.entry_type
    or new.amount is distinct from old.amount
    or new.created_at is distinct from old.created_at then
    raise exception 'immutable_quota_identity';
  end if;
  return new;
end;
$$;
create trigger preserve_quota_identity before insert or update on private.quota_ledger
for each row execute function private.preserve_quota_identity();

-- Deliberately no content/auth FK: upload intents and tombstones outlive cascades.
-- Result bytes are a short-lived durable outbox, removed on completion/deletion.
-- We cannot atomically commit a provider response with PostgreSQL; a crash before
-- this checkpoint is explicitly unknown and must never auto-submit again.
create table private.generation_work (
  generation_id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  claim_token uuid not null default gen_random_uuid(),
  lease_until timestamptz not null,
  deadline timestamptz not null,
  phase text not null check (phase in ('claimed','submitted','result','uploaded','completed','unknown','cancelled')),
  provider_outcome text check (provider_outcome in ('rejected','unknown')),
  storage_path text unique,
  result jsonb,
  cleanup_token uuid,
  cleanup_until timestamptz,
  cleanup_next_at timestamptz not null default now(),
  cleanup_attempts integer not null default 0,
  cleanup_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.generation_work enable row level security;
revoke all on private.generation_work from public, anon, authenticated, service_role;
create index generation_work_cleanup_idx on private.generation_work(cleanup_next_at) where storage_path is not null;

-- Locks follow deletion's order: account -> session -> generation -> work.
create function private.lock_live_generation(p_generation_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; session_uuid uuid;
begin
  select b.user_id,b.session_id into owner_id,session_uuid from public.generations g
    join public.generation_batches b on b.id=g.batch_id where g.id=p_generation_id;
  if owner_id is null then return false; end if;
  perform 1 from public.account_profiles where user_id=owner_id and status='active' for share;
  if not found then return false; end if;
  perform 1 from public.sessions where id=session_uuid and status='active' for share;
  if not found then return false; end if;
  perform 1 from public.generations where id=p_generation_id for update;
  return found;
end;
$$;

-- pgmq.read already locks the queue row. Never wait for generation-side locks
-- here: completion takes those locks before archiving the queue row.
create function private.try_lock_live_generation(p_generation_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; session_uuid uuid;
begin
  select b.user_id,b.session_id into owner_id,session_uuid from public.generations g
    join public.generation_batches b on b.id=g.batch_id where g.id=p_generation_id;
  if owner_id is null then return false; end if;
  perform 1 from public.account_profiles where user_id=owner_id and status='active' for share nowait;
  if not found then return false; end if;
  perform 1 from public.sessions where id=session_uuid and status='active' for share nowait;
  if not found then return false; end if;
  perform 1 from public.generations where id=p_generation_id for update nowait;
  return found;
exception when lock_not_available then return null;
end;
$$;
create function private.assert_generation_fence(p_generation_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare w private.generation_work%rowtype;
begin
  -- Legacy calls must wait for the claimant's authoritative row lock BEFORE
  -- reading its journal, including a journal inserted but not yet committed.
  if not private.lock_live_generation(p_generation_id) then raise exception 'generation_owner_deleted'; end if;
  select * into w from private.generation_work where generation_id=p_generation_id for update;
  if w.generation_id is not null and (w.claim_token::text is distinct from current_setting('zimage.claim_token',true)
      or w.lease_until <= clock_timestamp() or w.deadline <= clock_timestamp()) then
    raise exception 'generation_lease_lost';
  end if;
end;
$$;

-- When content disappears, preserve the intent/path for a repeatable orphan sweep.
create function private.cancel_deleted_generation_work() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.generation_work set phase='cancelled',result=null,updated_at=clock_timestamp(),
    cleanup_next_at=clock_timestamp() where generation_id=old.id;
  -- Only work demonstrably never dispatched is refunded, including queued work.
  if old.provider_submission_state='not_submitted' then
    insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key,
      original_batch_id,original_generation_id,created_at)
    select q.user_id,null,null,'release',1,'release:'||old.id,old.batch_id,old.id,q.created_at
      from private.quota_ledger q where q.original_generation_id=old.id and q.entry_type='reserve' and exists(select 1 from auth.users where id=q.user_id)
      on conflict (business_key) do nothing;
  end if;
  return old;
end;
$$;
-- AFTER permits release identities without a doomed content FK.
create trigger cancel_deleted_generation_work after delete on public.generations
for each row execute function private.cancel_deleted_generation_work();

create or replace function private.mark_provider_submission_started(p_generation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed boolean;
begin
  perform private.assert_generation_fence(p_generation_id);
  update public.generations
  set provider_submission_state = 'unknown'
  where id = p_generation_id and status = 'processing' and provider_submission_state = 'not_submitted';
  changed := found;
  return changed;
end;
$$;

create or replace function private.complete_image_generation(
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
  if not private.lock_live_generation(p_generation_id) then raise exception 'generation_owner_deleted'; end if;
  perform private.assert_generation_fence(p_generation_id);
  if exists(select 1 from public.generations where id=p_generation_id and status='succeeded' and storage_path=p_storage_path) then
    perform pgmq.archive('image_generation',p_message_id); return;
  end if;
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

create or replace function private.fail_image_generation(
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
  perform private.assert_generation_fence(p_generation_id);
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
      insert into private.quota_ledger (user_id, batch_id, generation_id, entry_type, amount, business_key, created_at)
      select generation_batches.user_id, generations.batch_id, generations.id, 'release', 1, 'release:' || generations.id::text, reserved.created_at
      from public.generations join public.generation_batches on generation_batches.id = generations.batch_id
      join private.quota_ledger reserved on reserved.original_generation_id=generations.id and reserved.entry_type='reserve'
      where generations.id = p_generation_id
      on conflict (business_key) do nothing;
    end if;
    perform private.record_provider_result(target_provider, true);
    perform private.refresh_generation_batch(target_batch_id);
  end if;
  perform pgmq.archive('image_generation', p_message_id);
end;
$$;

create or replace function private.retry_image_generation(p_generation_id uuid, p_error_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_batch_id uuid;
begin
  perform private.assert_generation_fence(p_generation_id);
  update public.generations
  set status = 'pending', error_code = left(p_error_code, 100)
  where id = p_generation_id and status = 'processing' and provider_submission_state = 'not_submitted'
  returning batch_id into target_batch_id;
  if target_batch_id is not null then perform private.refresh_generation_batch(target_batch_id); end if;
  return target_batch_id is not null;
end;
$$;

create or replace function private.claim_image_generation() returns jsonb
language plpgsql security definer set search_path='' as $$
declare q record; g record; w private.generation_work%rowtype; refs jsonb; action text; live boolean;
begin
  if not coalesce((select enabled from private.runtime_flags where flag='generation_enabled'),false) then return null; end if;
  select * into q from pgmq.read('image_generation',120,1) limit 1;
  if q.msg_id is null then return null; end if;
  live := private.try_lock_live_generation((q.message->>'generationId')::uuid);
  if live is null then return null; end if;
  if not live then
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','owner_or_generation_deleted');
  end if;
  select g0.*,b.user_id,b.session_id into g from public.generations g0
    join public.generation_batches b on b.id=g0.batch_id where g0.id=(q.message->>'generationId')::uuid;
  if g.status in ('succeeded','failed') then
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','terminal_generation');
  end if;
  select * into w from private.generation_work where generation_id=g.id for update;
  if w.generation_id is not null and w.lease_until > clock_timestamp() and w.deadline > clock_timestamp() then
    -- Queue visibility is advisory. A healthy lease is authoritative, even if a
    -- duplicate queue message or a delayed tick exposes this message again.
    return null;
  end if;
  if (w.generation_id is null and g.provider_submission_state <> 'not_submitted')
    or w.phase in ('submitted','unknown') then
    update public.generations set error_code='provider_reconciliation_required' where id=g.id;
    update private.generation_work set phase='unknown',result=null where generation_id=g.id;
    -- No provider query/idempotency API exists. Retain processing/quota so normal
    -- failed-item retry cannot silently buy another generation.
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','provider_reconciliation_required');
  end if;
  if w.phase='cancelled' then
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','cancelled');
  end if;
  action := case when w.phase in ('result','uploaded') then 'recover' else 'process' end;
  insert into private.generation_work(generation_id,user_id,session_id,lease_until,deadline,phase)
    values(g.id,g.user_id,g.session_id,clock_timestamp()+interval '120 seconds',clock_timestamp()+interval '10 minutes','claimed')
    on conflict(generation_id) do update set claim_token=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '120 seconds',deadline=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
    returning * into w;
  update public.generations set status='processing',attempt_count=attempt_count+1 where id=g.id;
  perform private.refresh_generation_batch(g.batch_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'bucket',r.storage_bucket,'path',r.storage_path,'mimeType',r.mime_type)
      order by requested.ordinality),'[]'::jsonb)
    into refs from jsonb_array_elements_text(coalesce(g.params->'referenceIds','[]'::jsonb)) with ordinality as requested(id,ordinality)
    join public.reference_uploads r on r.id=requested.id::uuid
    where r.user_id=g.user_id and r.session_id=g.session_id and r.status='active' and r.upload_expires_at>clock_timestamp();
  return jsonb_build_object('action',action,'messageId',q.msg_id,'readCount',q.read_ct,'generationId',g.id,
    'batchId',g.batch_id,'sessionId',g.session_id,'userId',g.user_id,'provider',g.provider,'model',g.model,
    'prompt',g.prompt,'params',g.params,'references',refs,'correlationId',q.message->>'correlationId',
    'claimToken',w.claim_token,'checkpoint',w.result,'phase',w.phase);
end;
$$;

create function public.generation_worker_step(p_generation_id uuid,p_claim_token uuid,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w private.generation_work%rowtype; g public.generations%rowtype; path text;
begin
  if not private.lock_live_generation(p_generation_id) then
    -- Persist cancellation even if the caller crashes before compensation.
    update private.generation_work set phase='cancelled',result=null,cleanup_next_at=clock_timestamp()
      where generation_id=p_generation_id and phase<>'cancelled';
    return jsonb_build_object('accepted',false);
  end if;
  select * into g from public.generations where id=p_generation_id;
  select * into w from private.generation_work where generation_id=p_generation_id for update;
  if w.generation_id is null or w.claim_token is distinct from p_claim_token or w.lease_until<=clock_timestamp()
    or w.deadline<=clock_timestamp() or w.phase='cancelled' then return jsonb_build_object('accepted',false); end if;
  if g.status='succeeded' and w.phase='completed' and p_operation='complete' then return jsonb_build_object('accepted',true); end if;
  if g.status<>'processing' then return jsonb_build_object('accepted',false); end if;
  perform set_config('zimage.claim_token',p_claim_token::text,true);
  if p_operation='fail' and w.phase='submitted' and p_payload->>'outcome' is distinct from 'rejected' then
    p_operation := 'unknown';
  end if;
  if p_operation='renew' then
    update private.generation_work set lease_until=least(deadline,clock_timestamp()+interval '120 seconds'),updated_at=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='submitted' then
    if w.phase<>'claimed' or not private.mark_provider_submission_started(p_generation_id) then return jsonb_build_object('accepted',false); end if;
    update private.generation_work set phase='submitted' where generation_id=p_generation_id;
  elsif p_operation='checkpoint' then
    if w.phase in ('result','uploaded') then
      return jsonb_build_object('accepted',w.result=p_payload);
    end if;
    if w.phase<>'submitted' then return jsonb_build_object('accepted',false); end if;
    path := w.user_id::text||'/'||w.session_id::text||'/'||p_generation_id::text||'/'||p_claim_token::text||'.'||
      case p_payload->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else '' end;
    if p_payload->>'storagePath' is distinct from path or right(path,1)='.'
      or coalesce(length(p_payload->>'bytesBase64'),0) not between 1 and 41943040 then raise exception 'invalid_result_checkpoint'; end if;
    update private.generation_work set phase='result',storage_path=path,result=p_payload,updated_at=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='uploaded' then
    if w.phase not in ('result','uploaded') then return jsonb_build_object('accepted',false); end if;
    update private.generation_work set phase='uploaded',updated_at=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='complete' then
    if w.phase<>'uploaded' then return jsonb_build_object('accepted',false); end if;
    perform private.complete_image_generation((p_payload->>'messageId')::bigint,p_generation_id,w.storage_path,w.result->>'providerRequestId');
    update private.generation_work set phase='completed',result=null,updated_at=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='retry' then
    if w.phase<>'claimed' then return jsonb_build_object('accepted',false); end if;
    perform private.retry_image_generation(p_generation_id,p_payload->>'code');
    update private.generation_work set lease_until=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='fail' then
    if w.phase not in ('claimed','submitted') then return jsonb_build_object('accepted',false); end if;
    perform private.fail_image_generation((p_payload->>'messageId')::bigint,p_generation_id,p_payload->>'code',w.phase='claimed',
      case when w.phase='claimed' then 'not_submitted' else 'submitted' end);
    update private.generation_work set phase='cancelled',provider_outcome=case when w.phase='submitted' then 'rejected' else null end,result=null where generation_id=p_generation_id;
  elsif p_operation='unknown' then
    if w.phase<>'submitted' then return jsonb_build_object('accepted',false); end if;
    update public.generations set error_code='provider_reconciliation_required' where id=p_generation_id;
    update private.generation_work set phase='unknown',provider_outcome='unknown' where generation_id=p_generation_id;
    perform pgmq.archive('image_generation',(p_payload->>'messageId')::bigint);
  else raise exception 'invalid_worker_operation';
  end if;
  return jsonb_build_object('accepted',true);
end;
$$;

alter table private.cleanup_jobs add column claim_token uuid, add column lease_until timestamptz;
alter table private.account_cleanup_jobs add column claim_token uuid, add column lease_until timestamptz;

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
  ) paths;
  return jsonb_build_object('attempt',target.attempts,'jobId',target.user_id,'jobType','account_delete',
    'objects',objects,'targetId',target.user_id,'claimToken',target.claim_token);
end;
$$;

-- All cleanup paths include durable intents. A snapshot can still precede an
-- in-flight write, so claim_cleanup_work also sweeps Storage metadata against
-- retained tombstones on EVERY pass, including previously removed paths.
create function public.claim_cleanup_work() returns jsonb
language plpgsql security definer set search_path='' as $$
declare w private.generation_work%rowtype; job jsonb; token uuid; objects jsonb;
begin
  select * into w from private.generation_work x
    where x.storage_path is not null and x.cleanup_next_at<=clock_timestamp()
      and (x.cleanup_until is null or x.cleanup_until<=clock_timestamp())
      and not exists (
        select 1 from public.generations g join public.generation_batches b on b.id=g.batch_id
          join public.sessions s on s.id=b.session_id join public.account_profiles a on a.user_id=b.user_id
        where g.id=x.generation_id and s.status='active' and a.status='active'
          and (g.status in ('pending','processing') or (g.status='succeeded' and g.asset_status='active'))
      ) and (x.phase<>'cancelled' or exists(select 1 from storage.objects o where o.bucket_id='generated' and o.name=x.storage_path))
    order by x.cleanup_next_at for update skip locked limit 1;
  if w.generation_id is not null then
    update private.generation_work set phase='cancelled',result=null,cleanup_token=gen_random_uuid(),
      cleanup_until=clock_timestamp()+interval '120 seconds',cleanup_attempts=cleanup_attempts+1
      where generation_id=w.generation_id returning * into w;
    return jsonb_build_object('attempt',w.cleanup_attempts,'jobId',w.generation_id,'targetId',w.generation_id,
      'jobType','orphan_result','claimToken',w.cleanup_token,'objects',jsonb_build_array(jsonb_build_object('bucket','generated','path',w.storage_path)));
  end if;
  update private.cleanup_jobs set status='failed',error_code='cleanup_lease_exhausted'
    where status='processing' and attempts>=5 and coalesce(lease_until,updated_at+interval '5 minutes')<=clock_timestamp();
  -- Make expired token leases eligible for the compatible five-minute claimant.
  update private.cleanup_jobs set status='failed' where status='processing' and lease_until<=clock_timestamp() and attempts<5;
  job := private.claim_cleanup_job();
  if job is not null then
    token := gen_random_uuid();
    update private.cleanup_jobs set claim_token=token,lease_until=clock_timestamp()+interval '120 seconds' where id=(job->>'jobId')::uuid;
    if job->>'jobType'='session_delete' then
      select coalesce(jsonb_agg(jsonb_build_object('bucket','generated','path',storage_path)),'[]'::jsonb) into objects
        from private.generation_work where session_id=(job->>'targetId')::uuid and storage_path is not null;
      job := jsonb_set(job,'{objects}',(job->'objects')||objects);
    end if;
    return job||jsonb_build_object('claimToken',token);
  end if;
  return public.claim_account_cleanup_job();
end;
$$;

create function public.cleanup_worker_step(p_job_id uuid,p_job_type text,p_claim_token uuid,p_operation text,p_error_code text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempts integer; token uuid; lease timestamptz; state text; finished boolean;
begin
  if p_job_type='orphan_result' then
    select cleanup_token,cleanup_until,cleanup_attempts into token,lease,attempts from private.generation_work where generation_id=p_job_id for update;
  elsif p_job_type='account_delete' then
    select c.claim_token,c.lease_until,c.attempts into token,lease,attempts from private.account_cleanup_jobs c where user_id=p_job_id for update;
    if not found and p_operation='complete' and not exists(select 1 from auth.users where id=p_job_id) then
      return jsonb_build_object('accepted',true,'dead',false);
    end if;
    select status into state from private.account_cleanup_jobs where user_id=p_job_id;
  else
    select claim_token,lease_until,c.attempts,c.status into token,lease,attempts,state from private.cleanup_jobs c where id=p_job_id and job_type=p_job_type for update;
  end if;
  if token is null or token is distinct from p_claim_token or lease<=clock_timestamp()
    or (p_job_type<>'orphan_result' and state<>'processing') then return jsonb_build_object('accepted',false,'dead',false); end if;
  perform set_config('zimage.cleanup_token',p_claim_token::text,true);
  if p_operation='renew' then
    if p_job_type='orphan_result' then
      update private.generation_work set cleanup_until=clock_timestamp()+interval '120 seconds' where generation_id=p_job_id;
    elsif p_job_type='account_delete' then
      update private.account_cleanup_jobs set lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() where user_id=p_job_id;
    else
      update private.cleanup_jobs set lease_until=clock_timestamp()+interval '120 seconds' where id=p_job_id;
    end if;
  elsif p_operation='complete' then
    if p_job_type='orphan_result' then
      update private.generation_work set cleanup_token=null,cleanup_until=null,cleanup_error=null,
        cleanup_next_at=clock_timestamp()+interval '30 seconds' where generation_id=p_job_id;
    elsif p_job_type='account_delete' then
      -- Completion follows Auth deletion. A surviving user is not complete.
      return jsonb_build_object('accepted',false,'dead',false);
    else
      finished := private.complete_cleanup_job(p_job_id);
      return jsonb_build_object('accepted',finished,'dead',false);
    end if;
  elsif p_operation='fail' then
    if p_job_type='orphan_result' then
      update private.generation_work set cleanup_token=null,cleanup_until=null,cleanup_error=left(p_error_code,100),
        cleanup_next_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) where generation_id=p_job_id;
    elsif p_job_type='account_delete' then
      perform public.fail_account_cleanup_job(p_job_id,p_error_code);
    else
      perform private.fail_cleanup_job(p_job_id,p_error_code);
    end if;
  else raise exception 'invalid_cleanup_operation'; end if;
  return jsonb_build_object('accepted',true,'attempts',attempts,'dead',p_job_type<>'orphan_result' and attempts>=5);
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

create or replace function private.fail_cleanup_job(p_job_id uuid, p_error_code text)
returns jsonb
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
  update private.cleanup_jobs
  set
    error_code = left(p_error_code, 100),
    next_run_at = case when attempts >= 5
      then timezone('utc', now()) + interval '100 years'
      else timezone('utc', now()) + make_interval(secs => least(3600, 30 * (2 ^ greatest(attempts - 1, 0))))
    end,
    status = 'failed'
  where id = p_job_id and status = 'processing'
  returning * into target;
  return jsonb_build_object('attempts', target.attempts, 'dead', coalesce(target.attempts >= 5, false));
end;
$$;

create or replace function public.complete_account_cleanup_job(p_user_id uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from private.account_cleanup_jobs where user_id=p_user_id for update;
  if exists(select 1 from private.account_cleanup_jobs where user_id=p_user_id and claim_token is not null
    and (claim_token::text is distinct from current_setting('zimage.cleanup_token',true) or lease_until<=clock_timestamp())) then
    raise exception 'cleanup_lease_lost';
  end if;
  update private.account_cleanup_jobs set status='completed',updated_at=timezone('utc',now()) where user_id=p_user_id and status='processing';
  return found;
end;
$$;

create or replace function public.fail_account_cleanup_job(p_user_id uuid,p_error_code text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare target private.account_cleanup_jobs%rowtype;
begin
  perform 1 from private.account_cleanup_jobs where user_id=p_user_id for update;
  if exists(select 1 from private.account_cleanup_jobs where user_id=p_user_id and claim_token is not null
    and (claim_token::text is distinct from current_setting('zimage.cleanup_token',true) or lease_until<=clock_timestamp())) then
    raise exception 'cleanup_lease_lost';
  end if;
  update private.account_cleanup_jobs set status='failed',error_code=left(p_error_code,100),updated_at=timezone('utc',now()),
    next_run_at=timezone('utc',now())+make_interval(secs=>least(3600,30*(2^greatest(attempts-1,0))))
    where user_id=p_user_id and status='processing' returning * into target;
  return jsonb_build_object('attempts',target.attempts,'dead',coalesce(target.attempts>=5,false));
end;
$$;

-- Explicitly restricted service boundary, including trigger/private helpers.
revoke all on function private.preserve_quota_identity(), private.lock_live_generation(uuid),
  private.assert_generation_fence(uuid), private.try_lock_live_generation(uuid), private.cancel_deleted_generation_work(),
  public.generation_worker_step(uuid,uuid,text,jsonb), public.claim_cleanup_work(),
  public.cleanup_worker_step(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.generation_worker_step(uuid,uuid,text,jsonb),
  public.claim_cleanup_work(), public.cleanup_worker_step(uuid,text,uuid,text,text) to service_role;

-- Covers archived pre-upgrade rows without inventing missing provider results.
create or replace function private.recreate_image_generation(
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
    where batch_id = p_batch_id and status = 'failed'
      and provider_submission_state <> 'unknown'
      and coalesce(error_code,'') not in ('provider_result_unknown','result_storage_failed','provider_reconciliation_required')
      and not (provider_submission_state='submitted' and coalesce(error_code,'') in ('provider_error','provider_unavailable')
        and not exists(select 1 from private.generation_work w where w.generation_id=generations.id and w.provider_outcome='rejected'));
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

  if p_mode='failed' and selected_count=0 and exists (
    select 1 from public.generations where batch_id=p_batch_id and status='failed'
      and (provider_submission_state='unknown' or error_code in ('provider_result_unknown','result_storage_failed','provider_reconciliation_required')
        or (provider_submission_state='submitted' and error_code in ('provider_error','provider_unavailable')))
  ) then raise exception using errcode='P0001',message='provider_reconciliation_required'; end if;
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
