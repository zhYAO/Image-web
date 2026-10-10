-- Real worker RPCs with transaction-local synthetic fixtures; isolated stack only.
-- No provider, Auth service or Storage request is made. Claims are DB state only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
update private.credit_settings set enabled=false where singleton;
delete from pgmq.q_image_generation;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
 values('a6100000-0000-4000-8000-000000000001','health-transitions@example.invalid',now(),false);
create temporary table transition_health_before as
 select coalesce(sum(total_count),0)::bigint total,coalesce(sum(error_count),0)::bigint errors
 from private.provider_health_windows where provider='gemini';

create function pg_temp.health_job() returns jsonb language plpgsql as $$
declare sid uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid(); mid bigint;
begin
 insert into public.sessions(id,user_id) values(sid,'a6100000-0000-4000-8000-000000000001');
 insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
  values(bid,'a6100000-0000-4000-8000-000000000001',sid,'direct','health fixture','gemini','test-model',
   '{"count":1,"aspectRatio":"1:1","resolution":"1K"}',bid::text,bid::text);
 insert into public.generations(id,batch_id,provider,model,prompt,params)
  values(gid,bid,'gemini','test-model','health fixture','{"aspectRatio":"1:1","resolution":"1K"}');
 insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key)
  values('a6100000-0000-4000-8000-000000000001',bid,gid,'reserve',1,'reserve:'||gid);
 mid:=pgmq.send('image_generation',jsonb_build_object('generationId',gid));
 return jsonb_build_object('generationId',gid,'sessionId',sid,'batchId',bid,'messageId',mid);
end;
$$;
create function pg_temp.health_step(c jsonb,op text,payload jsonb default '{}') returns boolean language sql as $$
 select (public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,op,payload)->>'accepted')::boolean;
$$;
create function pg_temp.expire_health_job(j jsonb) returns void language plpgsql as $$
begin
 update private.generation_work set lease_until=clock_timestamp()-interval '1 second' where generation_id=(j->>'generationId')::uuid;
 update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second' where msg_id=(j->>'messageId')::bigint;
end;
$$;
create temporary table health_cases(name text primary key,job jsonb,claim jsonb,reclaim jsonb);

insert into health_cases values('expired_submitted',pg_temp.health_job(),null,null);
update health_cases set claim=public.claim_image_generation() where name='expired_submitted';
select ok((select pg_temp.health_step(claim,'submitted') from health_cases where name='expired_submitted'),'expired scenario submitted through real boundary');
select pg_temp.expire_health_job(job) from health_cases where name='expired_submitted';
update health_cases set reclaim=public.claim_image_generation() where name='expired_submitted';
select is((select reclaim->>'reason' from health_cases where name='expired_submitted'),'provider_reconciliation_required','expired submitted claim goes to reconciliation');
select is((select count(*) from private.unknown_generation_health_receipts where generation_id=(select (job->>'generationId')::uuid from health_cases where name='expired_submitted')),1::bigint,'expired submitted sampled once');
select pg_temp.expire_health_job(job) from health_cases where name='expired_submitted';
update health_cases set reclaim=public.claim_image_generation() where name='expired_submitted';
select is((select count(*) from private.unknown_generation_health_receipts where generation_id=(select (job->>'generationId')::uuid from health_cases where name='expired_submitted')),1::bigint,'archive delivery replay retains one receipt');
select public.archive_image_message((job->>'messageId')::bigint) from health_cases where name='expired_submitted';

insert into health_cases values('legacy_first',pg_temp.health_job(),null,null);
update public.generations set status='processing',provider_submission_state='unknown'
 where id=(select (job->>'generationId')::uuid from health_cases where name='legacy_first');
update health_cases set reclaim=public.claim_image_generation() where name='legacy_first';
select is((select reclaim->>'action' from health_cases where name='legacy_first'),'archive','legacy no-journal submission is quarantined');
select is((select count(*) from private.unknown_generation_health_receipts where generation_id=(select (job->>'generationId')::uuid from health_cases where name='legacy_first')),1::bigint,'first legacy unknown creates one receipt');
select pg_temp.expire_health_job(job) from health_cases where name='legacy_first';
update health_cases set reclaim=public.claim_image_generation() where name='legacy_first';
select public.archive_image_message((job->>'messageId')::bigint) from health_cases where name='legacy_first';
select is((select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='gemini')-(select total from transition_health_before),2::bigint,'two distinct new unknown transitions sample twice');

insert into health_cases values('old_unknown_journal',pg_temp.health_job(),null,null);
update health_cases set claim=public.claim_image_generation() where name='old_unknown_journal';
select ok((select pg_temp.health_step(claim,'submitted') from health_cases where name='old_unknown_journal'),'old unknown fixture starts as submitted');
update private.generation_work set phase='unknown',provider_outcome='unknown'
 where generation_id=(select (job->>'generationId')::uuid from health_cases where name='old_unknown_journal');
update public.generations set error_code='provider_reconciliation_required'
 where id=(select (job->>'generationId')::uuid from health_cases where name='old_unknown_journal');
select pg_temp.expire_health_job(job) from health_cases where name='old_unknown_journal';
update health_cases set reclaim=public.claim_image_generation() where name='old_unknown_journal';
select is((select count(*) from private.unknown_generation_health_receipts where generation_id=(select (job->>'generationId')::uuid from health_cases where name='old_unknown_journal')),0::bigint,'old journal unknown is not backfilled');
select public.archive_image_message((job->>'messageId')::bigint) from health_cases where name='old_unknown_journal';

-- These fixtures represent historical error markers, not fresh transitions.
insert into health_cases(name,job) select marker,pg_temp.health_job()
 from unnest(array['provider_reconciliation_required','provider_result_unknown','result_unknown']) marker;
update public.generations g set status='processing',provider_submission_state='unknown',error_code=c.name
 from health_cases c where g.id=(c.job->>'generationId')::uuid
  and c.name in ('provider_reconciliation_required','provider_result_unknown','result_unknown');
do $$
declare c record; result jsonb;
begin
 for c in select * from health_cases where name in ('provider_reconciliation_required','provider_result_unknown','result_unknown') order by job->>'messageId' loop
  result:=public.claim_image_generation();
  if result->>'action' is distinct from 'archive' then raise exception 'old marker was not quarantined'; end if;
  perform public.archive_image_message((result->>'messageId')::bigint);
 end loop;
end;
$$;
select is((select count(*) from private.unknown_generation_health_receipts where generation_id in
 (select (job->>'generationId')::uuid from health_cases where name in ('provider_reconciliation_required','provider_result_unknown','result_unknown'))),0::bigint,'all three legacy unknown markers skip historical backfill');

-- Durable result/uploaded work recovers without being counted as unknown.
insert into health_cases(name,job) values('result',pg_temp.health_job());
update health_cases set claim=public.claim_image_generation() where name='result';
select ok((select pg_temp.health_step(claim,'submitted') from health_cases where name='result'),'result fixture submitted');
select ok((select pg_temp.health_step(claim,'checkpoint',jsonb_build_object(
 'storagePath',(claim->>'userId')||'/'||(claim->>'sessionId')||'/'||(claim->>'generationId')||'/'||(claim->>'claimToken')||'.png',
 'bytesBase64','eA==','mimeType','image/png','providerRequestId','synthetic')) from health_cases where name='result'),'result checkpoint recorded');
select pg_temp.expire_health_job(job) from health_cases where name='result';
update health_cases set reclaim=public.claim_image_generation() where name='result';
select is((select reclaim->>'action' from health_cases where name='result'),'recover','expired result is recovered');
select ok((select pg_temp.health_step(reclaim,'uploaded') from health_cases where name='result'),'uploaded checkpoint recorded without Storage request');
select pg_temp.expire_health_job(job) from health_cases where name='result';
update health_cases set reclaim=public.claim_image_generation() where name='result';
select is((select reclaim->>'action' from health_cases where name='result'),'recover','expired uploaded is recovered');
select is((select count(*) from private.unknown_generation_health_receipts where generation_id=(select (job->>'generationId')::uuid from health_cases where name='result')),0::bigint,'result recovery creates no unknown receipt');
select public.archive_image_message((job->>'messageId')::bigint) from health_cases where name='result';

insert into health_cases(name,job) values('deleted',pg_temp.health_job()),('terminal',pg_temp.health_job());
select public.request_session_deletion('a6100000-0000-4000-8000-000000000001',(job->>'sessionId')::uuid) from health_cases where name='deleted';
update public.generations set status='failed' where id=(select (job->>'generationId')::uuid from health_cases where name='terminal');
do $$
declare result jsonb;
begin
 result:=public.claim_image_generation();
 if result->>'reason' is distinct from 'owner_or_generation_deleted' then raise exception 'deletion not fenced'; end if;
 perform public.archive_image_message((result->>'messageId')::bigint);
 result:=public.claim_image_generation();
 if result->>'reason' is distinct from 'terminal_generation' then raise exception 'terminal not archived'; end if;
 perform public.archive_image_message((result->>'messageId')::bigint);
end;
$$;
select is((select count(*) from private.unknown_generation_health_receipts where generation_id in
 (select (job->>'generationId')::uuid from health_cases where name in ('deleted','terminal'))),0::bigint,'deletion and terminal archives create no unknown receipts');
select is((select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='gemini')-(select total from transition_health_before),2::bigint,'recovery/old unknown/deleted/terminal paths add no total samples');
select is((select coalesce(sum(error_count),0)::bigint from private.provider_health_windows where provider='gemini')-(select errors from transition_health_before),2::bigint,'only two newly unknown events add errors');
select is((select count(*) from private.quota_ledger where user_id='a6100000-0000-4000-8000-000000000001' and entry_type='release'),0::bigint,'unknown health does not release quota');
select * from finish();
rollback;
