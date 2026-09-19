begin;
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select no_plan();
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
values('c1000000-0000-4000-8000-000000000001','review-regressions@example.invalid',now(),false);
create function pg_temp.review_job(error_code text default null, submission_state text default 'not_submitted', reserved_at timestamptz default now())
returns uuid language plpgsql as $$
declare s uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); g uuid:=gen_random_uuid();
begin
  insert into public.sessions(id,user_id) values(s,'c1000000-0000-4000-8000-000000000001');
  insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
  values(b,'c1000000-0000-4000-8000-000000000001',s,'direct','test','gemini','test-model',
    '{"count":1,"aspectRatio":"1:1","resolution":"1K"}',b::text,b::text);
  insert into public.generations(id,batch_id,provider,model,prompt,params,status,error_code,provider_submission_state)
  values(g,b,'gemini','test-model','test','{}',case when error_code is null then 'pending' else 'failed' end,error_code,submission_state);
  insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key,created_at)
  values('c1000000-0000-4000-8000-000000000001',b,g,'reserve',1,'reserve:'||g,reserved_at);
  return g;
end;
$$;
create temporary table review_cases(name text primary key,gid uuid);
insert into review_cases values('old_cancel',pg_temp.review_job(null,'not_submitted',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'-interval '1 hour'));
delete from public.sessions where id=(select b.session_id from public.generation_batches b join public.generations g on g.batch_id=b.id
  where g.id=(select gid from review_cases where name='old_cancel'));
select is((select sum(case entry_type when 'reserve' then amount when 'release' then -amount else 0 end)
  from private.quota_ledger where user_id='c1000000-0000-4000-8000-000000000001'
  and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),null::bigint,'yesterday cancellation creates no current-day ledger entries');
select is((select created_at from private.quota_ledger where business_key='release:'||(select gid from review_cases where name='old_cancel')),
  (select created_at from private.quota_ledger where business_key='reserve:'||(select gid from review_cases where name='old_cancel')),'release uses original reservation timestamp');
insert into review_cases values('old_fail',pg_temp.review_job(null,'not_submitted',now()-interval '2 days'));
select public.fail_image_generation(0,(select gid from review_cases where name='old_fail'),'provider_unavailable',true,'not_submitted');
select is((select created_at from private.quota_ledger where business_key='release:'||(select gid from review_cases where name='old_fail')),
  (select created_at from private.quota_ledger where business_key='reserve:'||(select gid from review_cases where name='old_fail')),'legacy failure release uses original reservation timestamp');

-- Persisted pre-upgrade states have no journal, including archived queue results.
insert into review_cases values('legacy_unknown',pg_temp.review_job('provider_result_unknown','unknown')),
  ('legacy_storage',pg_temp.review_job('result_storage_failed','submitted')),
  ('legacy_typed',pg_temp.review_job('provider_error','submitted')),
  ('confirmed_rejection',pg_temp.review_job('moderation','submitted'));
select throws_ok(format('select private.recreate_image_generation(%L,%L,''failed'',null,%L,%L,%L)',
  'c1000000-0000-4000-8000-000000000001',g.batch_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),
  'P0001','provider_reconciliation_required','failed-only recreation excludes '||c.name)
  from review_cases c join public.generations g on g.id=c.gid where c.name in ('legacy_unknown','legacy_storage','legacy_typed');
select lives_ok(format('select private.recreate_image_generation(%L,%L,''failed'',null,%L,%L,%L)',
  'c1000000-0000-4000-8000-000000000001',g.batch_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),
  'confirmed rejection remains eligible for failed-only recreation')
  from review_cases c join public.generations g on g.id=c.gid where c.name='confirmed_rejection';
-- Fill today's remaining allowance with actual reserve rows; yesterday's refunds
-- must not let the authoritative submit RPC accept generation 31.
select pg_temp.review_job() from generate_series(1,25);
select throws_ok($sql$select private.submit_image_generation('c1000000-0000-4000-8000-000000000001',null,'over quota','gemini','test-model',
  '{"count":1,"aspectRatio":"1:1","resolution":"1K"}','direct',null,null,null,'review-over-quota','review-over-quota',gen_random_uuid())$sql$,
  'P0001','quota_exceeded','prior-day refunds do not permit a 31st current-day reservation');
-- The RPC also treats a post-submission 'fail' without rejection evidence as
-- unknown, even if a caller forgets the worker's TypeScript classification.
delete from pgmq.q_image_generation;
insert into review_cases values('managed_unknown',pg_temp.review_job());
select pgmq.send('image_generation',jsonb_build_object('generationId',gid)) from review_cases where name='managed_unknown';
create temporary table managed as select public.claim_image_generation() c;
select public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,'submitted') from managed;
select public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,'fail',jsonb_build_object('code','provider_error','messageId',c->'messageId')) from managed;
select is((select status from public.generations where id=(select gid from review_cases where name='managed_unknown')),'processing','ambiguous typed failure is not terminal failed');
select is((select count(*) from private.quota_ledger where original_generation_id=(select gid from review_cases where name='managed_unknown') and entry_type='release'),0::bigint,'ambiguous typed failure retains reservation');
insert into review_cases values('managed_rejected',pg_temp.review_job());
select pgmq.send('image_generation',jsonb_build_object('generationId',gid)) from review_cases where name='managed_rejected';
update managed set c=public.claim_image_generation();
select public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,'submitted') from managed;
select public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,'fail',jsonb_build_object('code','provider_error','outcome','rejected','messageId',c->'messageId')) from managed;
select is((select status from public.generations where id=(select gid from review_cases where name='managed_rejected')),'failed','proven provider rejection remains an ordinary failure');
select throws_ok(format('select private.recreate_image_generation(%L,%L,''failed'',null,%L,%L,%L)',
  'c1000000-0000-4000-8000-000000000001',g.batch_id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid()),
  'P0001','quota_exceeded','confirmed typed rejection reaches quota check rather than reconciliation exclusion')
  from review_cases c join public.generations g on g.id=c.gid where c.name='managed_rejected';
select * from finish();
rollback;
