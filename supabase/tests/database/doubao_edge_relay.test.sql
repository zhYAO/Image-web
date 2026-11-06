begin;select no_plan();
select ok(not has_function_privilege('authenticated','public.doubao_text_relay(uuid,uuid,text,text,jsonb)','execute'),'browser cannot use stage relay');
select ok(not has_table_privilege('service_role','private.doubao_stage_calls','select'),'stage receipts private');
insert into auth.users(id,email,email_confirmed_at,is_anonymous)values('abababab-0000-4000-8000-000000000001','doubao@example.invalid',now(),false);
update private.credit_settings set enabled=true;
update private.provider_runtime_config set enabled=true where provider='doubao';
create function pg_temp.stage(a text,p jsonb default '{}')returns jsonb language sql as $$select public.doubao_text_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000001','optimize',a,p)$$;
select throws_ok($$select pg_temp.stage('claim')$$,'P0001','relay_not_authorized','unfunded cannot call Ark');
create temporary table stage_input as select jsonb_build_object('requestId','babababa-0000-4000-8000-000000000001','operation','optimize','model','doubao','input','{"field":"title","text":"frozen"}'::jsonb)v;
select private.credit_dispatch_before_token('abababab-0000-4000-8000-000000000001','text_start',v||jsonb_build_object('billing',jsonb_build_object('version',(select version from private.credit_settings),'totalMinor',(select (j->>'unitMinor')::int from private.credit_price_versions p,jsonb_array_elements(p.prices)j where p.version=(select version from private.credit_settings)and j->>'model'='doubao'and j->>'operation'='optimize'))))from stage_input;
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_claim','{"requestId":"babababa-0000-4000-8000-000000000001"}');
select throws_ok($$select pg_temp.stage('claim','{"payloadHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","input":{"text":"tampered"}}')$$,'P0001','idempotency_conflict','optimization must match original funded input');
create temporary table stage_payload as select jsonb_build_object('payloadHash',repeat('a',64),'input',v->'input')v from stage_input;
select is(pg_temp.stage('inspect',(select v from stage_payload))->>'action','ready','inspection does not claim a supplier attempt');
select is((select count(*)::int from private.doubao_stage_calls),0,'configuration can be checked before attempt');
select is(pg_temp.stage('claim',(select v from stage_payload))->>'action','start','claimed optimization admitted once');
select throws_ok($$select pg_temp.stage('claim',(select v from stage_payload))$$,'P0001','relay_result_pending','unknown cannot buy again');
select throws_ok($$select pg_temp.stage('reject_not_started',(select v from stage_payload))$$,'P0001','relay_result_pending','a claimed supplier attempt can never be marked not-started');
select throws_ok($$select pg_temp.stage('read')$$,'P0001','relay_result_pending','read cannot start model');
select pg_temp.stage('result',(select v||jsonb_build_object('receipt',jsonb_build_object('text','{}','model','frozen'))from stage_payload));
select is(pg_temp.stage('read')#>>'{receipt,model}','frozen','saved receipt replays');
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_unknown','{"requestId":"babababa-0000-4000-8000-000000000001","reason":"transport response lost"}');
select is(pg_temp.stage('read')#>>'{receipt,model}','frozen','unknown keeps saved receipt for recovery');
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_result','{"requestId":"babababa-0000-4000-8000-000000000001","result":{"text":"validated","mock":false}}');
select is((select receipt from private.doubao_stage_calls),null::jsonb,'validated result clears duplicate raw optimization prose');
select is((select count(*)::int from private.doubao_stage_calls),1,'one provider attempt');
select is((select count(*)::int from private.credit_ledger where kind='capture'),0,'raw receipt does not capture');
-- Missing configuration refunds only an operation with no provider attempt.
select private.credit_dispatch_before_token('abababab-0000-4000-8000-000000000001','text_start',jsonb_set(v,'{requestId}','"babababa-0000-4000-8000-000000000002"')||jsonb_build_object('billing',jsonb_build_object('version',(select version from private.credit_settings),'totalMinor',(select (j->>'unitMinor')::int from private.credit_price_versions p,jsonb_array_elements(p.prices)j where p.version=(select version from private.credit_settings)and j->>'model'='doubao'and j->>'operation'='optimize'))))from stage_input;
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_claim','{"requestId":"babababa-0000-4000-8000-000000000002"}');
select is(public.doubao_text_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000002','optimize','reject_not_started',(select v from stage_payload))->>'notStarted','true','known no-attempt rejection has atomic evidence');
select is((select status from private.credit_operations where business_key='text:babababa-0000-4000-8000-000000000002'),'refunded','configuration rejection releases optimization funds');

-- Chat config proof is also mutually exclusive with any supplier claim.
create temporary table funded_chat as select private.credit_dispatch_before_token('abababab-0000-4000-8000-000000000001','text_start',jsonb_build_object('requestId','babababa-0000-4000-8000-000000000003','operation','chat','model','doubao','input',jsonb_build_object('message','frozen chat'),'billing',jsonb_build_object('version',(select version from private.credit_settings),'totalMinor',(select (j->>'unitMinor')::int from private.credit_price_versions p,jsonb_array_elements(p.prices)j where p.version=(select version from private.credit_settings)and j->>'model'='doubao'and j->>'operation'='chat'))))v;
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_claim','{"requestId":"babababa-0000-4000-8000-000000000003"}');
select is(public.doubao_chat_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000003','doubao','claim')#>>'{messages,0,content}','frozen chat','funded Doubao chat reconstructs original input');
select throws_ok($$select public.doubao_chat_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000003','doubao','reject_not_started')$$,'P0001','relay_result_pending','chat with a supplier attempt cannot refund as not-started');
select public.doubao_chat_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000003','doubao','result','saved chat');
select is(public.doubao_chat_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000003','doubao','claim')->>'action','replay','saved Doubao chat never calls supplier again');
select is((select jsonb_array_length(messages)from private.doubao_chat_calls),0,'completed Doubao chat clears copied history');
-- Explicit invalid-output refund clears a still recoverable raw optimization receipt.
select private.credit_dispatch_before_token('abababab-0000-4000-8000-000000000001','text_start',jsonb_set(v,'{requestId}','"babababa-0000-4000-8000-000000000004"')||jsonb_build_object('billing',jsonb_build_object('version',(select version from private.credit_settings),'totalMinor',(select (j->>'unitMinor')::int from private.credit_price_versions p,jsonb_array_elements(p.prices)j where p.version=(select version from private.credit_settings)and j->>'model'='doubao'and j->>'operation'='optimize'))))from stage_input;
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_claim','{"requestId":"babababa-0000-4000-8000-000000000004"}');
select public.doubao_text_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000004','optimize','claim',(select v from stage_payload));
select public.doubao_text_relay('abababab-0000-4000-8000-000000000001','babababa-0000-4000-8000-000000000004','optimize','result',(select v||jsonb_build_object('receipt',jsonb_build_object('text','invalid model output'))from stage_payload));
select public.credit_dispatch('abababab-0000-4000-8000-000000000001','text_refund','{"requestId":"babababa-0000-4000-8000-000000000004","reason":"invalid output"}');
select is((select c.receipt from private.doubao_stage_calls c join private.credit_operations o on o.id=c.operation_id where o.business_key='text:babababa-0000-4000-8000-000000000004'),null::jsonb,'definite refund clears raw optimization receipt');

delete from auth.users where id='abababab-0000-4000-8000-000000000001';
select is((select count(*)::int from private.doubao_stage_calls),0,'account cascade clears receipt');
select finish();rollback;
