begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Synthetic local transactions only. No provider calls or real Storage objects.
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='seedream';
update private.credit_settings set enabled=true;
delete from pgmq.q_image_generation;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
 values('f4000000-0000-4000-8000-000000000001','free-recovery@example.invalid',now(),false);
create function pg_temp.free_job() returns jsonb language plpgsql as $$
declare r uuid:=gen_random_uuid(); ignored jsonb;
begin
 ignored:=public.credit_dispatch('f4000000-0000-4000-8000-000000000001','image',jsonb_build_object(
 'requestId',r,'prompt','Synthetic local recovery','provider','seedream','model','doubao-seedream-5.0-pro',
 'config',jsonb_build_object('count',1,'resolution','2K','aspectRatio','1:1','referenceIds','[]'::jsonb,'registryVersion','2026-10-12.1'),
 'requestHash',r::text,'correlationId',gen_random_uuid(),'billing',jsonb_build_object('version','2026-10-12.1','totalMinor',30)));
 return public.claim_image_generation();
end; $$;
create function pg_temp.free_step(c jsonb,op text,p jsonb default '{}'::jsonb) returns boolean language sql as $$
 select (public.generation_worker_step((c->>'generationId')::uuid,(c->>'claimToken')::uuid,op,
 p||jsonb_build_object('messageId',(c->>'messageId')::bigint))->>'accepted')::boolean;
$$;
create function pg_temp.free_expire(c jsonb) returns void language plpgsql as $$
begin
 update private.generation_work set lease_until=clock_timestamp()-interval '1 second' where generation_id=(c->>'generationId')::uuid;
 update pgmq.q_image_generation set vt=clock_timestamp()-interval '1 second' where msg_id=(c->>'messageId')::bigint;
end; $$;
create temporary table free_claims(name text primary key,c jsonb);
insert into free_claims values('prepared',pg_temp.free_job());
select pg_temp.free_expire(c) from free_claims where name='prepared';
insert into free_claims values('fresh',public.claim_image_generation());
select is((select c->>'action' from free_claims where name='fresh'),'process','pre-submission expiry safely restarts preparation');
select ok((select c->>'claimToken' from free_claims where name='prepared')<>(select c->>'claimToken' from free_claims where name='fresh'),'reclaimed work has a fresh fence token');
select ok(not(select pg_temp.free_step(c,'submitted')from free_claims where name='prepared'),'expired preparation token cannot submit');
select ok((select pg_temp.free_step(c,'submitted')from free_claims where name='fresh'),'fresh token records one provider boundary');
select ok((select pg_temp.free_step(c,'checkpoint',jsonb_build_object('bytesBase64','aW1hZ2U=','mimeType','image/png','providerRequestId','synthetic-free-receipt',
 'storagePath',(c->>'userId')||'/'||(c->>'sessionId')||'/'||(c->>'generationId')||'/'||(c->>'claimToken')||'.png'))from free_claims where name='fresh'),'provider bytes and intent are durable before upload');
select pg_temp.free_expire(c)from free_claims where name='fresh';
insert into free_claims values('result-recovery',public.claim_image_generation());
select is((select c->>'action'from free_claims where name='result-recovery'),'recover','result checkpoint never returns a provider process action');
select is((select c#>>'{checkpoint,providerRequestId}'from free_claims where name='result-recovery'),'synthetic-free-receipt','recovery preserves the same provider receipt');
select ok(not(select pg_temp.free_step(c,'complete')from free_claims where name='fresh'),'old result owner cannot settle after fencing');
select ok((select pg_temp.free_step(c,'uploaded')from free_claims where name='result-recovery'),'result recovery may record upload');
select pg_temp.free_expire(c)from free_claims where name='result-recovery';
insert into free_claims values('upload-recovery',public.claim_image_generation());
select is((select c->>'action'from free_claims where name='upload-recovery'),'recover','uploaded expiry only recovers persistence and settlement');
select ok(not(select pg_temp.free_step(c,'complete')from free_claims where name='result-recovery'),'old upload token cannot settle');
select ok((select pg_temp.free_step(c,'complete')from free_claims where name='upload-recovery'),'new owner completes the same result');
select ok((select pg_temp.free_step(c,'complete')from free_claims where name='upload-recovery'),'completion replay is accepted idempotently');
select is((select spent_minor from private.credit_wallets where user_id='f4000000-0000-4000-8000-000000000001'),30::bigint,'all recovery attempts capture one image price');
select is((select frozen_minor from private.credit_wallets where user_id='f4000000-0000-4000-8000-000000000001'),0::bigint,'completed recovery releases the reservation');
insert into free_claims values('submitted',pg_temp.free_job());
select ok((select pg_temp.free_step(c,'submitted')from free_claims where name='submitted'),'second job crosses provider boundary');
select pg_temp.free_expire(c)from free_claims where name='submitted';
insert into free_claims values('unknown',public.claim_image_generation());
select is((select c->>'reason'from free_claims where name='unknown'),'provider_reconciliation_required','submitted expiry never asks for another provider attempt');
select is((select status from private.credit_operations where original_generation_id=(select(c->>'generationId')::uuid from free_claims where name='submitted')),'needs_review','ambiguous provider result remains reviewable');
select is((select frozen_minor from private.credit_wallets where user_id='f4000000-0000-4000-8000-000000000001'),30::bigint,'unknown result retains its reservation');
select is((select spent_minor from private.credit_wallets where user_id='f4000000-0000-4000-8000-000000000001'),30::bigint,'unknown result cannot add a charge');
select is((select available_minor+frozen_minor+spent_minor from private.credit_wallets where user_id='f4000000-0000-4000-8000-000000000001'),1000::bigint,'wallet is conserved across all lease recoveries');
select finish();
rollback;
