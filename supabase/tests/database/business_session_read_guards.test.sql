-- Isolated genuine schema/functions only. Synthetic JWT claims are not a signed
-- JWT or Auth sign-out test. All content and cleanup fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
select ok(not has_table_privilege('authenticated','public.creative_batches','select'),'legacy batch table has no direct browser SELECT');
select ok(not has_function_privilege('authenticated','public.get_creative_batch_progress(uuid,uuid)','execute'),'history projection remains service-only');

insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('a5000000-0000-4000-8000-000000000001','read-owner@example.invalid',now(),false),
 ('a5000000-0000-4000-8000-000000000002','read-other@example.invalid',now(),false);
insert into auth.sessions(id,user_id) values
 ('a5000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000001');
insert into public.sessions(id,user_id,title) values
 ('a5000000-0000-4000-8000-000000000011','a5000000-0000-4000-8000-000000000001','Owner read fixture'),
 ('a5000000-0000-4000-8000-000000000012','a5000000-0000-4000-8000-000000000002','Other read fixture');
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash) values
 ('a5000000-0000-4000-8000-000000000021','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011','direct','fixture','gemini','test-model','{}','read-owner','read-owner'),
 ('a5000000-0000-4000-8000-000000000022','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000012','direct','fixture','gemini','test-model','{}','read-other','read-other');
insert into public.generations(id,batch_id,provider,model,prompt,params) values
 ('a5000000-0000-4000-8000-000000000031','a5000000-0000-4000-8000-000000000021','gemini','test-model','fixture','{}'),
 ('a5000000-0000-4000-8000-000000000032','a5000000-0000-4000-8000-000000000022','gemini','test-model','fixture','{}');
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height) values
 ('a5000000-0000-4000-8000-000000000041','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011','synthetic/owner.png','owner.png','image/png',1,1,1),
 ('a5000000-0000-4000-8000-000000000042','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000012','synthetic/other.png','other.png','image/png',1,1,1);
insert into public.commerce_tasks(id,user_id,session_id) values
 ('a5000000-0000-4000-8000-000000000051','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011'),
 ('a5000000-0000-4000-8000-000000000052','a5000000-0000-4000-8000-000000000002','a5000000-0000-4000-8000-000000000012');
insert into public.commerce_revisions(task_id,revision,plan) values
 ('a5000000-0000-4000-8000-000000000051',1,'{}'),('a5000000-0000-4000-8000-000000000052',1,'{}');
insert into public.commerce_runs(task_id,revision,request_id) values
 ('a5000000-0000-4000-8000-000000000051',1,'a5000000-0000-4000-8000-000000000061'),
 ('a5000000-0000-4000-8000-000000000052',1,'a5000000-0000-4000-8000-000000000062');
insert into public.creative_batches(id,user_id,session_id,request_id,request_hash,workflow,items) values
 ('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011',gen_random_uuid(),'history','product-set',
  '[{"id":"a5000000-0000-4000-8000-000000000081","taskId":"a5000000-0000-4000-8000-000000000051","submitRequestId":"a5000000-0000-4000-8000-000000000061","status":"created"},
    {"id":"a5000000-0000-4000-8000-000000000082","taskId":"a5000000-0000-4000-8000-000000000051","submitRequestId":"a5000000-0000-4000-8000-000000000061","status":"needs_review"},
    {"id":"a5000000-0000-4000-8000-000000000083","taskId":"a5000000-0000-4000-8000-000000000051","submitRequestId":"a5000000-0000-4000-8000-000000000069","status":"created"},
    {"id":"a5000000-0000-4000-8000-000000000084","taskId":"a5000000-0000-4000-8000-000000000052","submitRequestId":"a5000000-0000-4000-8000-000000000062","status":"needs_review"}]');

select is(public.get_creative_batch_progress('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001')#>>'{items,0,status}','submitted','created item with exact run reads as submitted');
select is(public.get_creative_batch_progress('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001')#>>'{items,1,status}','submitted','needs_review item with exact run reads as submitted');
select is(public.get_creative_batch_progress('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001')#>>'{items,2,status}','created','different request ID does not imply a submission');
select is(public.get_creative_batch_progress('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001')#>>'{items,3,status}','needs_review','other owner/session run cannot confirm submission');
select is((select items#>>'{0,status}' from public.creative_batches where id='a5000000-0000-4000-8000-000000000071'),'created','GET projection does not mutate historical JSON');

set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claims','{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a5000000-0000-4000-8000-000000000010"}',true);
end $$;
select is(public.require_verified_user_id(),'a5000000-0000-4000-8000-000000000001'::uuid,'live login baseline');
select is((select count(*) from public.generation_batches),1::bigint,'active owner sees only own generation batch');
select is((select count(*) from public.generations),1::bigint,'generation inherits owner batch visibility');
select is((select count(*) from public.reference_uploads),1::bigint,'active owner sees only own reference');
select throws_ok('select * from public.creative_batches','42501','permission denied for table creative_batches','old direct table path is revoked');
reset role;

set local role service_role;
select is(public.request_session_deletion('a5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000011'),'accepted','business delete accepted');
select is(public.get_creative_batch_progress('a5000000-0000-4000-8000-000000000071','a5000000-0000-4000-8000-000000000001'),null::jsonb,'privileged history projection denies deleted parent');
reset role;
select is((select count(*) from private.cleanup_jobs where job_type='session_delete' and target_id='a5000000-0000-4000-8000-000000000011'),1::bigint,'cleanup job remains discoverable');
select is((select count(*) from public.generations),2::bigint,'cleanup owner still sees retained child rows');

set local role authenticated;
select is(public.require_verified_user_id(),'a5000000-0000-4000-8000-000000000001'::uuid,'business deletion does not revoke the login');
select is((select count(*) from public.generation_batches),0::bigint,'deleted business parent hides generation batch');
select is((select count(*) from public.generations),0::bigint,'deleted business parent hides generation through batch RLS');
select is((select count(*) from public.reference_uploads),0::bigint,'deleted business parent hides reference');
reset role;
delete from auth.sessions where id='a5000000-0000-4000-8000-000000000010';
set local role authenticated;
select throws_ok('select public.require_verified_user_id()','P0001','unauthorized','stale synthetic claims cannot use live-login gateway');
reset role;
select * from finish();
rollback;
