-- A confirmed provider rejection survives audit/settlement outages without a
-- provider retry. This journal column is private; public worker RPC signatures
-- and the existing legacy audit/fail endpoints remain compatible.
alter table private.generation_work add column rejection_code text
  constraint generation_work_rejection_code_check check (rejection_code in ('moderation','provider_error','provider_unavailable'));

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
  -- A persisted rejection is a known provider fact. Recover only its audit and
  -- settlement before the uncertainty branch, never a second provider call.
  if w.phase='submitted' and w.provider_outcome='rejected' and w.rejection_code is not null then
    action := 'recover_rejection';
  elsif (w.generation_id is null and g.provider_submission_state <> 'not_submitted')
    or w.phase in ('submitted','unknown') then
    -- Count only the first observed unknown transition; do not backfill old
    -- unknown rows/legacy markers or count a durable confirmed rejection.
    if (w.phase='submitted' and w.provider_outcome is distinct from 'unknown')
      or (w.generation_id is null and coalesce(g.error_code,'') not in
        ('provider_reconciliation_required','provider_result_unknown','result_unknown')) then
      perform private.record_unknown_generation_health_once(g.id,g.provider);
    end if;
    update public.generations set error_code='provider_reconciliation_required' where id=g.id;
    update private.generation_work set phase='unknown',result=null where generation_id=g.id;
    -- No provider query/idempotency API exists. Retain processing/quota so normal
    -- failed-item retry cannot silently buy another generation.
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','provider_reconciliation_required');
  end if;
  if w.phase='cancelled' then
    return jsonb_build_object('action','archive','messageId',q.msg_id,'reason','cancelled');
  end if;
  action := coalesce(action,case when w.phase in ('result','uploaded') then 'recover' else 'process' end);
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
    'claimToken',w.claim_token,'checkpoint',w.result,'rejectionCode',w.rejection_code,'phase',w.phase);
end;
$$;

create or replace function public.generation_worker_step(p_generation_id uuid,p_claim_token uuid,p_operation text,p_payload jsonb default '{}'::jsonb)
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
    or w.deadline<=clock_timestamp() then return jsonb_build_object('accepted',false); end if;
  if g.status='succeeded' and w.phase='completed' and p_operation='complete' then return jsonb_build_object('accepted',true); end if;
  -- A lost finalization response can be replayed only by the same live token.
  -- No writes means no duplicate audit, refund or provider health sample.
  if g.status='failed' and w.phase='cancelled' and w.provider_outcome='rejected' and p_operation='fail'
    and p_payload->>'outcome'='rejected' and g.error_code=p_payload->>'code'
    and (w.rejection_code is null or w.rejection_code=p_payload->>'code') then
    return jsonb_build_object('accepted',g.error_code<>'moderation' or exists(
      select 1 from private.image_safety_audits a where a.generation_id=g.id and a.provider=g.provider
        and a.correlation_id=g.correlation_id and a.category='provider_content_policy' and a.decision='block'));
  end if;
  if w.phase='cancelled' or g.status<>'processing' then return jsonb_build_object('accepted',false); end if;
  if w.rejection_code is not null and p_operation not in ('renew','checkpoint_rejection','fail') then
    return jsonb_build_object('accepted',false);
  end if;
  if w.rejection_code is not null and p_operation='fail' and
    (p_payload->>'code' is distinct from w.rejection_code or p_payload->>'outcome' is distinct from 'rejected') then
    return jsonb_build_object('accepted',false);
  end if;
  perform set_config('zimage.claim_token',p_claim_token::text,true);
  if p_operation='fail' and w.phase='submitted' and p_payload->>'outcome' is distinct from 'rejected' then
    p_operation := 'unknown';
  end if;
  if p_operation='renew' then
    update private.generation_work set lease_until=least(deadline,clock_timestamp()+interval '120 seconds'),updated_at=clock_timestamp() where generation_id=p_generation_id;
  elsif p_operation='submitted' then
    if w.phase<>'claimed' or not private.mark_provider_submission_started(p_generation_id) then return jsonb_build_object('accepted',false); end if;
    update private.generation_work set phase='submitted' where generation_id=p_generation_id;
  elsif p_operation='checkpoint_rejection' then
    if w.phase<>'submitted' or p_payload->>'outcome' is distinct from 'rejected'
      or coalesce(p_payload->>'code','') not in ('moderation','provider_error','provider_unavailable')
      or w.provider_outcome='unknown'
      or (w.rejection_code is not null and w.rejection_code is distinct from p_payload->>'code') then
      return jsonb_build_object('accepted',false);
    end if;
    if w.rejection_code is null then
      update private.generation_work set provider_outcome='rejected',rejection_code=p_payload->>'code',updated_at=clock_timestamp()
        where generation_id=p_generation_id;
    end if;
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
    -- Preserve legacy audit+fail callers. The row lock serializes worker
    -- finalization, while an existing complete audit satisfies this operation.
    if w.phase='submitted' and p_payload->>'code'='moderation' and not exists(
      select 1 from private.image_safety_audits a where a.generation_id=g.id and a.provider=g.provider
        and a.correlation_id=g.correlation_id and a.category='provider_content_policy' and a.decision='block') then
      perform private.record_image_safety_decision(g.id,'provider_content_policy','block');
    end if;
    perform private.fail_image_generation((p_payload->>'messageId')::bigint,p_generation_id,p_payload->>'code',w.phase='claimed',
      case when w.phase='claimed' then 'not_submitted' else 'submitted' end);
    update private.generation_work set phase='cancelled',provider_outcome=case when w.phase='submitted' then 'rejected' else null end,result=null where generation_id=p_generation_id;
  elsif p_operation='unknown' then
    if w.phase<>'submitted' then return jsonb_build_object('accepted',false); end if;
    perform private.record_unknown_generation_health_once(g.id,g.provider);
    update public.generations set error_code='provider_reconciliation_required' where id=p_generation_id;
    update private.generation_work set phase='unknown',provider_outcome='unknown' where generation_id=p_generation_id;
    perform pgmq.archive('image_generation',(p_payload->>'messageId')::bigint);
  else raise exception 'invalid_worker_operation';
  end if;
  return jsonb_build_object('accepted',true);
end;
$$;
