begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Real local transactions/queue/billing; no provider or physical Storage calls.
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='seedream';
update private.credit_settings set enabled=true;
delete from pgmq.q_image_generation;
delete from private.provider_health_windows where provider='seedream';
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
  values('f3000000-0000-4000-8000-000000000001','rejection@example.invalid',now(),false);
create function pg_temp.new_rejection_job() returns jsonb language plpgsql as $$
declare request_id uuid:=gen_random_uuid(); admitted jsonb;
begin
  admitted:=public.credit_dispatch('f3000000-0000-4000-8000-000000000001','image',jsonb_build_object(
    'requestId',request_id,'prompt','Local rejection test','provider','seedream','model','doubao-seedream-5.0-pro',
    'config',jsonb_build_object('count',1,'resolution','2K','aspectRatio','1:1','referenceIds','[]'::jsonb,'registryVersion','2026-10-12.1'),
    'requestHash',request_id::text,'correlationId',gen_random_uuid(),
    'billing',jsonb_build_object('version','2026-10-12.1','totalMinor',30)));
  return public.claim_image_generation();
end;
$$;
create function pg_temp.rejection_step(c jsonb,op text,code text default 'moderation') returns boolean language sql as $$
  select (public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,op,
    jsonb_build_object('code',code,'outcome','rejected','messageId',(c->>'messageId')::bigint))->>'accepted')::boolean;
$$;
create function pg_temp.rejection_release_count(c jsonb) returns bigint language sql as $$
  select count(*) from private.credit_ledger l join private.credit_operations o on o.id=l.operation_id
    where o.original_generation_id=(c->>'generationId')::uuid and l.kind='release';
$$;
create function pg_temp.rejection_health_count() returns bigint language sql as $$
  select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='seedream';
$$;
create temporary table rejection_cases(name text primary key,claim jsonb);
insert into rejection_cases values('atomic',pg_temp.new_rejection_job());
select is((select claim->>'action' from rejection_cases where name='atomic'),'process','paid job admitted');
select ok((select pg_temp.rejection_step(claim,'submitted') from rejection_cases where name='atomic'),'provider boundary recorded');
select ok(not (select (public.generation_worker_step((claim->>'generationId')::uuid,null,'checkpoint_rejection',
  '{"code":"moderation","outcome":"rejected"}')->>'accepted')::boolean from rejection_cases where name='atomic'),'null token cannot checkpoint');
select ok(not (select (public.generation_worker_step((claim->>'generationId')::uuid,gen_random_uuid(),'checkpoint_rejection',
  '{"code":"moderation","outcome":"rejected"}')->>'accepted')::boolean from rejection_cases where name='atomic'),'different token cannot checkpoint');
update private.generation_work set lease_until=clock_timestamp()-interval '1 second';
select ok(not (select pg_temp.rejection_step(claim,'checkpoint_rejection') from rejection_cases where name='atomic'),'expired lease cannot checkpoint');
update private.generation_work set lease_until=clock_timestamp()+interval '120 seconds';
select ok((select pg_temp.rejection_step(claim,'checkpoint_rejection') from rejection_cases where name='atomic'),'definite rejection checkpoint saved');
select ok(not (select pg_temp.rejection_step(claim,'checkpoint_rejection','reference_download_failed') from rejection_cases where name='atomic'),'non-provider rejection code denied');
select ok((select pg_temp.rejection_step(claim,'checkpoint_rejection') from rejection_cases where name='atomic'),'same rejection checkpoint replay accepted');
select ok(not (select pg_temp.rejection_step(claim,'checkpoint_rejection','provider_error') from rejection_cases where name='atomic'),'checkpoint cannot change its durable code');
select ok(not (select pg_temp.rejection_step(claim,'fail','provider_error') from rejection_cases where name='atomic'),'finalization cannot bypass moderation audit by changing code');
select ok(not (select pg_temp.rejection_step(claim,'unknown') from rejection_cases where name='atomic'),'known rejection cannot become unknown');
select is((select frozen_minor from private.credit_wallets where user_id='f3000000-0000-4000-8000-000000000001'),30::bigint,'checkpoint alone retains hold');
select is(pg_temp.rejection_health_count(),0::bigint,'checkpoint alone records no provider sample');

-- The audit INSERT fails within the finalization transaction. pgTAP catches
-- that subtransaction; the earlier journal checkpoint must survive unchanged.
create function pg_temp.reject_audit_insert() returns trigger language plpgsql as $$begin raise exception 'test_audit_unavailable'; end;$$;
create trigger rejection_test_audit_failure before insert on private.image_safety_audits for each row execute function pg_temp.reject_audit_insert();
select throws_ok($$select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='atomic'$$,'P0001','test_audit_unavailable','audit failure rejects atomic finalization');
select is((select status from public.generations where id=(select (claim->>'generationId')::uuid from rejection_cases where name='atomic')),'processing','audit failure rolls back failed status');
select is((select phase||':'||provider_outcome||':'||rejection_code from private.generation_work where generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='atomic')),'submitted:rejected:moderation','earlier durable rejection survives audit rollback');
select is((select count(*) from private.image_safety_audits where generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='atomic')),0::bigint,'failed audit wrote no partial row');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='atomic'),0::bigint,'audit failure made no refund');
select is(pg_temp.rejection_health_count(),0::bigint,'audit failure made no health sample');
select is((select count(*) from pgmq.q_image_generation),1::bigint,'audit failure preserves recoverable queue message');
drop trigger rejection_test_audit_failure on private.image_safety_audits;
create temporary table old_rejection_claim as select claim from rejection_cases where name='atomic';
update private.generation_work set lease_until=clock_timestamp()-interval '1 second';
select ok(not (select pg_temp.rejection_step(claim,'fail') from old_rejection_claim),'expired token cannot finalize');
update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second';
update rejection_cases set claim=public.claim_image_generation() where name='atomic';
select is((select claim->>'action' from rejection_cases where name='atomic'),'recover_rejection','lease expiry recovers a known rejection instead of unknown');
select is((select claim->>'rejectionCode' from rejection_cases where name='atomic'),'moderation','recovery carries the durable code');
select isnt((select claim->>'claimToken' from rejection_cases where name='atomic'),(select claim->>'claimToken' from old_rejection_claim),'recovery replaces the old token');
select ok(not (select pg_temp.rejection_step(claim,'fail') from old_rejection_claim),'replaced token cannot finalize');
select is(pg_temp.rejection_health_count(),0::bigint,'rejection recovery never counts unknown');
select ok((select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='atomic'),'recovery atomically audits and finalizes');
select ok((select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='atomic'),'lost final response replay accepted');
select ok(not (select pg_temp.rejection_step(claim,'fail','provider_error') from rejection_cases where name='atomic'),'terminal replay with a different code denied');
select is((select count(*) from private.image_safety_audits a join public.generations g on g.id=a.generation_id
  where a.generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='atomic')
    and a.provider=g.provider and a.correlation_id=g.correlation_id and a.category='provider_content_policy' and a.decision='block'),1::bigint,'one complete minimal moderation audit');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='atomic'),1::bigint,'one release after finalization replay');
select is((select status from private.credit_operations where original_generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='atomic')),'refunded','known rejection refunded');
select is((select frozen_minor from private.credit_wallets where user_id='f3000000-0000-4000-8000-000000000001'),0::bigint,'hold released after complete audit');
select is(pg_temp.rejection_health_count(),1::bigint,'one rejected health sample after replay');
select is((select count(*) from pgmq.q_image_generation),0::bigint,'finalization archives queue message');
update private.generation_work set deadline=clock_timestamp()-interval '1 second';
select ok(not (select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='atomic'),'expired deadline rejects even terminal replay');

-- Legacy workers still audit separately then fail with no rejection checkpoint.
insert into rejection_cases values('legacy',pg_temp.new_rejection_job());
select ok((select pg_temp.rejection_step(claim,'submitted') from rejection_cases where name='legacy'),'legacy job submits');
select public.record_image_safety_decision((claim->>'generationId')::uuid,'provider_content_policy','block') from rejection_cases where name='legacy';
select ok((select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='legacy'),'legacy audit plus fail remains compatible');
select ok((select pg_temp.rejection_step(claim,'fail') from rejection_cases where name='legacy'),'legacy terminal fail replay accepted');
select is((select count(*) from private.image_safety_audits where generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='legacy')),1::bigint,'existing complete legacy audit is not duplicated');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='legacy'),1::bigint,'legacy confirmed rejection refunded once');
select is(pg_temp.rejection_health_count(),2::bigint,'legacy rejection recorded once');

-- Ordinary definite errors do not create a moderation audit. Ambiguous provider
-- work remains held/manual and never enters the rejection recovery path.
insert into rejection_cases values('definite_error',pg_temp.new_rejection_job());
select ok((select pg_temp.rejection_step(claim,'submitted') from rejection_cases where name='definite_error'),'definite error submits');
select ok((select pg_temp.rejection_step(claim,'checkpoint_rejection','provider_error') from rejection_cases where name='definite_error'),'non-moderation definite error checkpoint');
select ok((select pg_temp.rejection_step(claim,'fail','provider_error') from rejection_cases where name='definite_error'),'non-moderation definite error finalizes');
select is((select count(*) from private.image_safety_audits where generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='definite_error')),0::bigint,'non-moderation rejection creates no moderation audit');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='definite_error'),1::bigint,'non-moderation confirmed rejection refunded');
insert into rejection_cases values('unknown',pg_temp.new_rejection_job());
select ok((select pg_temp.rejection_step(claim,'submitted') from rejection_cases where name='unknown'),'ambiguous provider job submits');
select ok((select pg_temp.rejection_step(claim,'unknown') from rejection_cases where name='unknown'),'unknown outcome recorded');
select is((select status from public.generations where id=(select (claim->>'generationId')::uuid from rejection_cases where name='unknown')),'processing','unknown retains processing');
select is((select status from private.credit_operations where original_generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='unknown')),'needs_review','unknown requires manual reconciliation');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='unknown'),0::bigint,'unknown never refunded');
select is((select frozen_minor from private.credit_wallets where user_id='f3000000-0000-4000-8000-000000000001'),30::bigint,'unknown retains credit hold');
select is(pg_temp.rejection_health_count(),4::bigint,'three definite failures and one unknown recorded');
update private.generation_work set lease_until=clock_timestamp()-interval '1 second'
  where generation_id=(select (claim->>'generationId')::uuid from rejection_cases where name='unknown');
select pgmq.send('image_generation',jsonb_build_object('generationId',claim->'generationId')) from rejection_cases where name='unknown';
select is(public.claim_image_generation()->>'reason','provider_reconciliation_required','expired unknown is archived for manual reconciliation instead of rejection recovery');
select is(pg_temp.rejection_health_count(),4::bigint,'unknown redelivery adds no health sample');
select is((select pg_temp.rejection_release_count(claim) from rejection_cases where name='unknown'),0::bigint,'unknown redelivery still cannot refund');
select is((select frozen_minor from private.credit_wallets where user_id='f3000000-0000-4000-8000-000000000001'),30::bigint,'unknown redelivery retains payment hold');
select finish();
rollback;
