
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('d1000000-0000-4000-8000-000000000001','legacy-upgrade@example.invalid',now(),false);
insert into public.sessions(id,user_id) values('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
values('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','direct','upgrade','gemini','test-model','{"count":3,"aspectRatio":"1:1","resolution":"1K"}','upgrade','upgrade');
insert into public.generations(id,batch_id,provider,model,prompt,params,status,provider_submission_state,error_code)
select id::uuid,'d3000000-0000-4000-8000-000000000001','gemini','test-model','upgrade','{}','failed',submission,error
from (values ('d4000000-0000-4000-8000-000000000001','unknown','provider_result_unknown'),
 ('d4000000-0000-4000-8000-000000000002','submitted','result_storage_failed'),
 ('d4000000-0000-4000-8000-000000000003','submitted','moderation')) t(id,submission,error);
insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key)
select 'd1000000-0000-4000-8000-000000000001',batch_id,id,'reserve',1,'reserve:'||id from public.generations where batch_id='d3000000-0000-4000-8000-000000000001';
