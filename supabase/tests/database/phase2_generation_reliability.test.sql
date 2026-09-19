begin;
-- Transactional metadata fixtures simulate Storage API deletion; no physical objects exist.
-- https://github.com/supabase/storage/pull/817
set local storage.allow_delete_query = 'true';
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select no_plan();
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';

-- Transaction-local fixtures: execute real queue/worker/cleanup RPCs, never inspect
-- function definition strings. Safe to run only against an isolated local stack.
delete from pgmq.q_image_generation;
delete from private.cleanup_jobs;
delete from private.account_cleanup_jobs;
update private.runtime_flags set enabled=true where flag='generation_enabled';
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values('a1000000-0000-4000-8000-000000000001','reliability@example.invalid',now(),false);
create function pg_temp.new_job() returns jsonb language plpgsql as $$
declare sid uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); mid bigint;
begin
  insert into public.sessions(id,user_id) values(sid,'a1000000-0000-4000-8000-000000000001');
  insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
    values(bid,'a1000000-0000-4000-8000-000000000001',sid,'direct','test','gemini','test-model',
      '{"count":1,"aspectRatio":"1:1","resolution":"1K"}',bid::text,bid::text);
  insert into public.generations(id,batch_id,provider,model,prompt,params)
    values(gid,bid,'gemini','test-model','test','{"aspectRatio":"1:1","resolution":"1K"}');
  insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key)
    values('a1000000-0000-4000-8000-000000000001',bid,gid,'reserve',1,'reserve:'||gid);
  mid:=pgmq.send('image_generation',jsonb_build_object('generationId',gid));
  return jsonb_build_object('generationId',gid,'sessionId',sid,'batchId',bid,'messageId',mid);
end;
$$;
create function pg_temp.step(c jsonb,op text,payload jsonb default '{}'::jsonb) returns boolean language sql as $$
  select (public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,op,payload)->>'accepted')::boolean;
$$;
create temporary table cases(name text primary key,job jsonb,claim jsonb);
insert into cases values('known',pg_temp.new_job(),null);
update cases set claim=public.claim_image_generation() where name='known';
select is((select claim->>'action' from cases where name='known'),'process','new job is dispatched');
select ok((select pg_temp.step(claim,'renew') from cases where name='known'),'lease renews');
select ok(not (select (public.generation_worker_step((claim->>'generationId')::uuid,null,'renew')->>'accepted')::boolean from cases where name='known'),'null generation fence cannot renew a claim');
update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second';
select is(public.claim_image_generation(),null::jsonb,'visible message cannot replace a live lease');
select is((select attempt_count from public.generations where id=(select (job->>'generationId')::uuid from cases where name='known')),1,'duplicate delivery did not dispatch twice');
select ok((select pg_temp.step(claim,'submitted') from cases where name='known'),'provider boundary recorded once');
select ok(not (select pg_temp.step(claim,'submitted') from cases where name='known'),'same claim cannot submit provider twice');

-- Checkpoint is committed before Storage. Simulate a restart AFTER upload and
-- BEFORE completion: the new token recovers exactly the same result/path.
create temporary table saved as select claim,
  jsonb_build_object('storagePath',(claim->>'userId')||'/'||(claim->>'sessionId')||'/'||(claim->>'generationId')||'/'||(claim->>'claimToken')||'.png',
    'bytesBase64','aW1hZ2U=','mimeType','image/png','providerRequestId','provider-1') payload
  from cases where name='known';
select ok((select pg_temp.step(claim,'checkpoint',payload) from saved),'bytes and intent durably checkpointed');
select ok((select pg_temp.step(claim,'uploaded') from saved),'upload success recorded');
update private.generation_work set lease_until=clock_timestamp()-interval '1 second';
update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second';
update cases set claim=public.claim_image_generation() where name='known';
select is((select claim->>'action' from cases where name='known'),'recover','expired uploaded work resumes without provider');
select is((select claim->'checkpoint' from cases where name='known'),(select payload from saved),'checkpoint survives worker crash');
select ok(not (select pg_temp.step(claim,'complete',jsonb_build_object('messageId',claim->'messageId')) from saved),'old token cannot complete after reclaim');
select ok((select pg_temp.step(claim,'complete',jsonb_build_object('messageId',claim->'messageId')) from cases where name='known'),'new token completes saved result');
select ok((select pg_temp.step(claim,'complete',jsonb_build_object('messageId',claim->'messageId')) from cases where name='known'),'lost completion response is idempotent');
select is((select count(*) from private.quota_ledger where entry_type='settle'),1::bigint,'one settlement after completion retries');
select is((select result from private.generation_work where generation_id=(select (job->>'generationId')::uuid from cases where name='known')),null::jsonb,'completed byte outbox is removed');

-- C02: physical session cleanup cannot remove a consumed reserve/settle.
select public.request_session_deletion('a1000000-0000-4000-8000-000000000001',(select (job->>'sessionId')::uuid from cases where name='known'));
create temporary table cleanup as select public.claim_cleanup_work() claim;
-- The compensation sweep may run first; finish it, then claim session deletion.
select public.cleanup_worker_step((claim->>'jobId')::uuid,claim->>'jobType',(claim->>'claimToken')::uuid,'complete') from cleanup;
update cleanup set claim=public.claim_cleanup_work() where claim->>'jobType'='orphan_result';
select is((select claim->>'jobType' from cleanup),'session_delete','session deletion can follow compensation');
select public.cleanup_worker_step((claim->>'jobId')::uuid,claim->>'jobType',(claim->>'claimToken')::uuid,'complete') from cleanup;
select is((select count(*) from public.sessions where id=(select (job->>'sessionId')::uuid from cases where name='known')),0::bigint,'session physically removed');
select is((select sum(case entry_type when 'reserve' then amount when 'release' then -amount else 0 end) from private.quota_ledger),1::bigint,'content removal retains consumed quota');
select ok((select bool_and(batch_id is null and generation_id is null and original_generation_id is not null) from private.quota_ledger),'nullable navigation references retain immutable target');

-- C03: an object appears AFTER the cleanup snapshot and content cascade. The
-- retained tombstone must be reclaimable again from real Storage metadata.
insert into storage.objects(bucket_id,name) select 'generated',payload->>'storagePath' from saved;
update private.generation_work set cleanup_next_at=clock_timestamp()-interval '1 second';
update cleanup set claim=public.claim_cleanup_work();
select is((select claim->>'jobType' from cleanup),'orphan_result','late object found after deletion completed');
select is((select claim->'objects'->0->>'path' from cleanup),(select payload->>'storagePath' from saved),'late object retains exact compensation path');
delete from storage.objects where bucket_id='generated' and name=(select payload->>'storagePath' from saved);
select public.cleanup_worker_step((claim->>'jobId')::uuid,claim->>'jobType',(claim->>'claimToken')::uuid,'complete') from cleanup;

-- C04: a crashed provider submission has no query API. Preserve uncertainty and
-- quota; it must not appear in the ordinary failed-generation retry selection.
insert into cases values('unknown',pg_temp.new_job(),null);
update cases set claim=public.claim_image_generation() where name='unknown';
select ok((select pg_temp.step(claim,'submitted') from cases where name='unknown'),'uncertain job starts only once');
update private.generation_work set lease_until=clock_timestamp()-interval '1 second' where generation_id=(select (job->>'generationId')::uuid from cases where name='unknown');
update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second';
select is(public.claim_image_generation()->>'reason','provider_reconciliation_required','expired provider submission requires reconciliation');
select is((select status from public.generations where id=(select (job->>'generationId')::uuid from cases where name='unknown')),'processing','unknown provider result excluded from failed retry');
select ok(not (select pg_temp.step(claim,'submitted') from cases where name='unknown'),'expired worker cannot restart provider');
delete from pgmq.q_image_generation;

-- A claim with no provider submission can be taken over, but its stale token
-- cannot mark submission after the successor owns it.
insert into cases values('unsubmitted',pg_temp.new_job(),null);
update cases set claim=public.claim_image_generation() where name='unsubmitted';
create temporary table old_unsubmitted as select claim from cases where name='unsubmitted';
update private.generation_work set lease_until=clock_timestamp()-interval '1 second' where generation_id=(select (job->>'generationId')::uuid from cases where name='unsubmitted');
update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second';
update cases set claim=public.claim_image_generation() where name='unsubmitted';
select ok(not (select pg_temp.step(claim,'submitted') from old_unsubmitted),'stale pre-submission worker is fenced');
select public.request_session_deletion('a1000000-0000-4000-8000-000000000001',(select (job->>'sessionId')::uuid from cases where name='unsubmitted'));
select ok(not (select pg_temp.step(claim,'submitted') from cases where name='unsubmitted'),'deletion blocks provider dispatch');
delete from public.sessions where id=(select (job->>'sessionId')::uuid from cases where name='unsubmitted');
select is((select count(*) from private.quota_ledger where entry_type='release' and original_generation_id=(select (job->>'generationId')::uuid from cases where name='unsubmitted')),1::bigint,'only demonstrably unsubmitted cancellation releases quota');
delete from private.cleanup_jobs;

-- Legacy public complete/submit contracts are preserved. An unleased legacy
-- processing job still completes idempotently with the original four arguments.
insert into cases values('legacy',pg_temp.new_job(),null);
update public.generations set status='processing' where id=(select (job->>'generationId')::uuid from cases where name='legacy');
select ok(public.mark_provider_submission_started((select (job->>'generationId')::uuid from cases where name='legacy')),'legacy submission marker signature remains usable');
select lives_ok($sql$select public.complete_image_generation((job->>'messageId')::bigint,(job->>'generationId')::uuid,'legacy/result.png','legacy-provider') from cases where name='legacy'$sql$,'legacy complete RPC remains compatible');
select lives_ok($sql$select public.complete_image_generation((job->>'messageId')::bigint,(job->>'generationId')::uuid,'legacy/result.png','legacy-provider') from cases where name='legacy'$sql$,'legacy completion retry is idempotent');
select is((select count(*) from private.quota_ledger where entry_type='settle' and original_generation_id=(select (job->>'generationId')::uuid from cases where name='legacy')),1::bigint,'legacy completion settles only once');

-- Managed claims cannot fall through to unfenced old mutators.
select set_config('zimage.claim_token','',true);
select throws_ok($sql$select public.fail_image_generation((job->>'messageId')::bigint,(job->>'generationId')::uuid,'stale',false,'unknown') from cases where name='unknown'$sql$,'P0001','generation_lease_lost','unfenced old failure RPC cannot override managed work');
select ok(has_function_privilege('service_role','public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)','execute'),'commerce keeps the old atomic submit signature');

-- C06: account claim crash, expired reclaim, stale failure and completion.
update public.account_profiles set status='deleting' where user_id='a1000000-0000-4000-8000-000000000001';
insert into private.account_cleanup_jobs(user_id) values('a1000000-0000-4000-8000-000000000001');
create temporary table account_claims as select public.claim_account_cleanup_job() old_claim,null::jsonb new_claim;
update private.account_cleanup_jobs set lease_until=clock_timestamp()-interval '1 second';
update account_claims set new_claim=public.claim_account_cleanup_job();
select is((select (new_claim->>'attempt')::integer from account_claims),2,'expired processing account cleanup reclaimed');
select ok(not (select (public.cleanup_worker_step((new_claim->>'jobId')::uuid,'account_delete',null,'renew')->>'accepted')::boolean from account_claims),'null cleanup fence cannot renew a claim');
select isnt((select old_claim->>'claimToken' from account_claims),(select new_claim->>'claimToken' from account_claims),'reclaim changes fence token');
select ok(not (select (public.cleanup_worker_step((old_claim->>'jobId')::uuid,'account_delete',(old_claim->>'claimToken')::uuid,'fail','old failure')->>'accepted')::boolean from account_claims),'stale account worker cannot overwrite newer claim');
select is((select status from private.account_cleanup_jobs where user_id='a1000000-0000-4000-8000-000000000001'),'processing','new account claim stays processing');
select ok((select (public.cleanup_worker_step((new_claim->>'jobId')::uuid,'account_delete',(new_claim->>'claimToken')::uuid,'renew')->>'accepted')::boolean from account_claims),'current account cleanup can renew');
-- Simulate successful Auth admin deletion (local fixture only).
delete from auth.users where id='a1000000-0000-4000-8000-000000000001';
select ok((select (public.cleanup_worker_step((new_claim->>'jobId')::uuid,'account_delete',(new_claim->>'claimToken')::uuid,'complete')->>'accepted')::boolean from account_claims),'Auth cascade completion response can be retried');

-- A crash on the final allowed account attempt becomes an observable failed
-- job instead of remaining silently processing forever.
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
  values('a1000000-0000-4000-8000-000000000002','dead-cleanup@example.invalid',now(),false);
insert into private.account_cleanup_jobs(user_id,status,attempts,lease_until)
  values('a1000000-0000-4000-8000-000000000002','processing',5,clock_timestamp()-interval '1 second');
select is(public.claim_account_cleanup_job(),null::jsonb,'exhausted stale account job is not silently redispatched');
select is((select error_code from private.account_cleanup_jobs where user_id='a1000000-0000-4000-8000-000000000002'),'cleanup_lease_exhausted','exhaustion remains observable for manual action');

select ok(not has_function_privilege('anon','public.generation_worker_step(uuid,uuid,text,jsonb)','execute'),'anon cannot mutate worker state');
select ok(not has_function_privilege('authenticated','public.generation_worker_step(uuid,uuid,text,jsonb)','execute'),'authenticated cannot mutate worker state');
select ok(has_function_privilege('service_role','public.generation_worker_step(uuid,uuid,text,jsonb)','execute'),'service can mutate fenced worker state');
select ok(not has_table_privilege('service_role','private.generation_work','select'),'result bytes accessible only through restricted RPC');
select ok(not has_function_privilege('authenticated','public.claim_cleanup_work()','execute'),'cleanup claimant restricted');
select ok(not has_function_privilege('authenticated','public.cleanup_worker_step(uuid,text,uuid,text,text)','execute'),'cleanup mutation restricted');
select ok(not has_function_privilege('authenticated','private.lock_live_generation(uuid)','execute'),'private owner-lock helper restricted');
select * from finish();
rollback;
