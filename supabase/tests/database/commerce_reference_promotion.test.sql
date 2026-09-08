begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.rid(label text) returns uuid language sql immutable as $$select md5('reference-history:'||label)::uuid$$;
create temporary table reference_test_state(key text primary key,value jsonb);
create function pg_temp.keep(label text,data jsonb) returns void language sql as $$
  insert into reference_test_state values(label,data) on conflict(key) do update set value=excluded.value;
$$;
create function pg_temp.saved(label text) returns jsonb language sql as $$select value from reference_test_state where key=label$$;
create function pg_temp.promote(source text default 'generation-1',request text default 'request-1',metadata jsonb default null)
returns jsonb language sql as $$ select public.promote_commerce_reference(pg_temp.rid('owner'),pg_temp.rid('task'),pg_temp.rid(request),pg_temp.rid(source),metadata); $$;
create function pg_temp.meta() returns jsonb language sql as $$select '{"name":"reference.png","mimeType":"image/png","size":68,"width":1,"height":1}'::jsonb$$;
create function pg_temp.intent(label text,op text) returns jsonb language sql as $$
  select public.reference_write_intent(pg_temp.rid('owner'),(pg_temp.saved(label)->>'referenceId')::uuid,op);
$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  (pg_temp.rid('owner'),'reference-owner@example.com',now(),false),(pg_temp.rid('other'),'reference-other@example.com',now(),false);
insert into public.sessions(id,user_id,title) values
  (pg_temp.rid('session'),pg_temp.rid('owner'),'References'),(pg_temp.rid('capacity'),pg_temp.rid('owner'),'Capacity'),
  (pg_temp.rid('second'),pg_temp.rid('owner'),'Other session');
insert into public.commerce_tasks(id,user_id,session_id) values(pg_temp.rid('task'),pg_temp.rid('owner'),pg_temp.rid('session'));
insert into public.commerce_revisions(task_id,revision,plan) values(pg_temp.rid('task'),1,'{}');
insert into public.commerce_runs(id,task_id,revision,request_id) values(pg_temp.rid('run'),pg_temp.rid('task'),1,pg_temp.rid('run-request'));
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
delete from private.provider_health_windows where provider='gemini';
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash)
select pg_temp.rid('batch-'||n),pg_temp.rid('owner'),pg_temp.rid(case when n=4 then 'second' else 'session' end),'direct','Product','gemini','gemini-3-pro-image','{}','ref-'||n,'hash' from generate_series(1,4) n;
insert into public.generations(id,batch_id,provider,model,prompt,params,status,asset_status,storage_bucket,storage_path,asset_expires_at)
select pg_temp.rid('generation-'||n),pg_temp.rid('batch-'||n),'gemini','gemini-3-pro-image','Product','{}','succeeded','active','generated','reference-test/generated-'||n,now()+interval '1 day' from generate_series(1,4) n;
insert into public.commerce_run_items(run_id,task_id,slot_id,position,batch_id,generation_id,compatibility_hash,selection_version)
select pg_temp.rid('run'),pg_temp.rid('task'),pg_temp.rid('slot-'||n),n,pg_temp.rid('batch-'||n),pg_temp.rid('generation-'||n),'hash',0 from generate_series(1,4) n;

insert into storage.objects(bucket_id,name,metadata) select 'generated',storage_path,jsonb_build_object('size',68) from public.generations where batch_id in (select id from public.generation_batches where user_id=pg_temp.rid('owner'));

select ok(not has_function_privilege('anon','public.promote_commerce_reference(uuid,uuid,uuid,uuid,jsonb)','execute'),'promotion disallows anon');
select ok(not has_function_privilege('authenticated','public.promote_commerce_reference(uuid,uuid,uuid,uuid,jsonb)','execute'),'promotion identity cannot be spoofed by user RPC');
select ok(not has_function_privilege('authenticated','public.reference_write_intent(uuid,uuid,text)','execute'),'intent protocol is service-only');
select ok(has_function_privilege('service_role','public.claim_cleanup_work()','execute'),'claim ABI grant preserved');
select ok(has_function_privilege('service_role','public.cleanup_worker_step(uuid,text,uuid,text,text)','execute'),'step ABI grant preserved');
select ok(not has_function_privilege('service_role','private.claim_cleanup_work_before_reference_history()','execute'),'inner claimant cannot bypass wrapper');
select ok(not has_table_privilege('service_role','private.reference_write_intents','select'),'intent table is private');
select is((select count(*) from pg_constraint where conrelid='private.reference_write_intents'::regclass and contype='f'),0::bigint,'intent has no cascading foreign keys');
select throws_ok($$select public.promote_commerce_reference(pg_temp.rid('other'),pg_temp.rid('task'),gen_random_uuid(),pg_temp.rid('generation-1'))$$,'42501','task_not_found','cross-owner rejected');
select throws_ok($$select pg_temp.promote('foreign-generation')$$,'42501','source_not_found','foreign source rejected');
select throws_ok($$select pg_temp.promote('generation-4')$$,'42501','source_not_found','same owner other session rejected');
update public.generations set status='processing',asset_status=null,asset_expires_at=null where id=pg_temp.rid('generation-3');
select throws_ok($$select pg_temp.promote('generation-3')$$,'P0001','source_not_succeeded','unknown processing result cannot promote');
update public.generations set status='succeeded',asset_status='active',asset_expires_at=now()-interval '1 second' where id=pg_temp.rid('generation-3');
select throws_ok($$select pg_temp.promote('generation-3')$$,'P0001','source_expired','expired source rejected');
update public.generations set asset_expires_at=now()+interval '1 day' where id=pg_temp.rid('generation-3');
select is(pg_temp.promote()->>'storagePath','reference-test/generated-1','lookup returns private key only to service');
select throws_ok($$select pg_temp.promote('generation-2')$$,'23505','idempotency_conflict','same request another source conflicts before copy');
select throws_ok($$select pg_temp.promote('generation-1','oversize',jsonb_set(pg_temp.meta(),'{size}','10485761'))$$,'P0001','invalid_reference_metadata','SQL independently bounds size');
select pg_temp.keep('first',pg_temp.promote('generation-1','request-1',pg_temp.meta()));
select is((select source_generation_id from public.reference_uploads where id=(pg_temp.saved('first')->>'referenceId')::uuid),pg_temp.rid('generation-1'),'source generation tracked');
select is((select status from public.reference_uploads where id=(pg_temp.saved('first')->>'referenceId')::uuid),'expired','pending metadata cannot be used as active model input');
select is((select count(*) from private.reference_write_intents),1::bigint,'metadata and durable intent exist before upload');
select is(public.claim_cleanup_work(),null::jsonb,'live pending writer protected');
select throws_ok($$select pg_temp.promote('generation-1','parallel',pg_temp.meta())$$,'P0001','reference_in_progress','concurrent same-source preparation fenced');
select throws_ok($$select pg_temp.intent('first','finalize')$$,'P0001','reference_object_not_found','missing Storage metadata cannot finalize');
insert into storage.objects(bucket_id,name) values('uploads',pg_temp.saved('first')->>'storagePath');
select pg_temp.keep('result',pg_temp.intent('first','finalize'));
select is(pg_temp.saved('result')->>'id',pg_temp.saved('first')->>'referenceId','finalization returns uploaded reference ID');
select is(pg_temp.promote('generation-1','new-request')->'reference',pg_temp.saved('result'),'same generation reuses active reference across requests');
select is(pg_temp.promote()->'reference',pg_temp.saved('result'),'same request reuses active reference');
select is(public.claim_cleanup_work(),null::jsonb,'ready active object not swept');
select is(pg_temp.intent('first','abandon'),' {"remove":false}'::jsonb,'lost finalize response cannot delete active object');

-- Ordinary uploads insert inactive metadata then register before writing.
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height,status)
values(pg_temp.rid('ordinary'),pg_temp.rid('owner'),pg_temp.rid('session'),pg_temp.rid('owner')||'/'||pg_temp.rid('session')||'/references/'||pg_temp.rid('ordinary')||'/reference.png','reference.png','image/png',68,1,1,'expired');
select is(public.reference_write_intent(pg_temp.rid('owner'),pg_temp.rid('ordinary'),'register'),'true'::jsonb,'ordinary upload uses same preregistration RPC');
select is((select write_state from public.reference_uploads where id=pg_temp.rid('ordinary')),'pending','registration reserves capacity without exposing active input');
select is(public.reference_write_intent(pg_temp.rid('owner'),pg_temp.rid('ordinary'),'abandon'),' {"remove":true}'::jsonb,'ordinary compensation is durable before remove');

-- Bounded retained history grows beyond four without changing plan/input limits.
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
select pg_temp.rid('capacity-'||n),pg_temp.rid('owner'),pg_temp.rid('capacity'),'capacity/'||n,'reference.png','image/png',68,1,1 from generate_series(1,64) n;
select is((select count(*) from public.reference_uploads where session_id=pg_temp.rid('capacity')),64::bigint,'64 retained references accepted');
select throws_ok($$insert into public.reference_uploads(user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
values(pg_temp.rid('owner'),pg_temp.rid('capacity'),'capacity/65','reference.png','image/png',68,1,1)$$,'23514','reference_capacity_64','65th retained reference rejected');
select throws_ok($$update public.reference_uploads set session_id=pg_temp.rid('capacity') where id=(pg_temp.saved('first')->>'referenceId')::uuid$$,'23514','reference_capacity_64','moving active reference cannot bypass capacity');

-- An interrupted writer without an object releases pending metadata capacity.
select pg_temp.keep('stalled',pg_temp.promote('generation-2','stalled-request',pg_temp.meta()));
update private.reference_write_intents set write_until=clock_timestamp()-interval '1 second'
  where reference_id=(pg_temp.saved('stalled')->>'referenceId')::uuid;
select pg_temp.keep('claim',public.claim_cleanup_work());
select is(pg_temp.saved('claim')->>'jobId',pg_temp.saved('stalled')->>'referenceId','stalled pending writer is swept even without Storage metadata');
select is((select count(*) from public.reference_uploads where id=(pg_temp.saved('stalled')->>'referenceId')::uuid),0::bigint,'stalled writer releases history capacity');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'complete')->>'accepted','true','empty-object compensation completes durably');

-- Expired live rows are swept; the old reference-expiry metadata cleanup still
-- executes through the unchanged inner implementation and public token ABI.
update public.reference_uploads set upload_expires_at=now()-interval '1 second'
  where id=(pg_temp.saved('first')->>'referenceId')::uuid;
select pg_temp.keep('claim',public.claim_cleanup_work());
select is(pg_temp.saved('claim')->>'jobId',pg_temp.saved('first')->>'referenceId','expired active reference with Storage metadata is swept');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'renew')->>'accepted','true','expired reference does not block orphan renewal');
delete from storage.objects where name=pg_temp.saved('first')->>'storagePath';
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'complete')->>'accepted','true','expired object removal completes');
select pg_temp.keep('legacy-claim',public.claim_cleanup_work());
select is(pg_temp.saved('legacy-claim')->>'jobType','reference_expiry','legacy claimant delegation preserved');
select is(public.cleanup_worker_step((pg_temp.saved('legacy-claim')->>'jobId')::uuid,'reference_expiry',(pg_temp.saved('legacy-claim')->>'claimToken')::uuid,'complete')->>'accepted','true','legacy step delegation preserved');

-- Abandonment removes pending metadata but leaves an immortal path tombstone.
select pg_temp.keep('second',pg_temp.promote('generation-2','request-2',pg_temp.meta()));
select is(pg_temp.intent('second','abandon'),' {"remove":true}'::jsonb,'failed finalization authorizes compensation');
select is((select count(*) from public.reference_uploads where id=(pg_temp.saved('second')->>'referenceId')::uuid),0::bigint,'failed metadata removed');
insert into storage.objects(bucket_id,name) values('uploads',pg_temp.saved('second')->>'storagePath');
select pg_temp.keep('claim',public.claim_cleanup_work());
select is(pg_temp.saved('claim')->>'jobType','orphan_reference','late object swept through new claim type');
select is(pg_temp.saved('claim')->'objects'->0->>'bucket','uploads','new intent never uses generation journal');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',gen_random_uuid(),'complete')->>'accepted','false','wrong token fenced');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'renew')->>'accepted','true','lease can renew');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'fail','secret source URL')->>'dead','false','cleanup retries remain durable');
select ok((select cleanup_next_at>clock_timestamp() and cleanup_error='reference_storage_cleanup_failed' from private.reference_write_intents where reference_id=(pg_temp.saved('second')->>'referenceId')::uuid),'failure backs off and stores safe error code only');
update private.reference_write_intents set cleanup_next_at=clock_timestamp()-interval '1 second' where reference_id=(pg_temp.saved('second')->>'referenceId')::uuid;
select pg_temp.keep('claim',public.claim_cleanup_work());
update private.reference_write_intents set cleanup_until=clock_timestamp()-interval '1 second' where reference_id=(pg_temp.saved('claim')->>'jobId')::uuid;
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'renew')->>'accepted','false','expired lease fenced');
select pg_temp.keep('claim',public.claim_cleanup_work());
delete from storage.objects where name=pg_temp.saved('second')->>'storagePath';
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'complete')->>'accepted','true','cleanup completes after Storage removal');
select ok(exists(select 1 from private.reference_write_intents where reference_id=(pg_temp.saved('second')->>'referenceId')::uuid),'completed cleanup retains tombstone');
insert into storage.objects(bucket_id,name) values('uploads',pg_temp.saved('second')->>'storagePath');
update private.reference_write_intents set cleanup_next_at=clock_timestamp()-interval '1 second' where reference_id=(pg_temp.saved('second')->>'referenceId')::uuid;
select is(public.claim_cleanup_work()->>'jobId',pg_temp.saved('second')->>'referenceId','another late upload after completion is swept again');
delete from storage.objects where name=pg_temp.saved('second')->>'storagePath';

-- Account deletion between preregistration and upload cannot erase compensation.
select pg_temp.keep('third',pg_temp.promote('generation-3','request-3',pg_temp.meta()));
delete from auth.users where id=pg_temp.rid('owner');
select ok(exists(select 1 from private.reference_write_intents where reference_id=(pg_temp.saved('third')->>'referenceId')::uuid),'intent survives cascading account deletion');
select throws_ok($$select pg_temp.intent('third','finalize')$$,'42501','unauthorized','deleted account cannot finalize');
insert into storage.objects(bucket_id,name) values('uploads',pg_temp.saved('third')->>'storagePath');
-- Isolate this intent from the earlier ready ref whose account was also deleted.
update private.reference_write_intents set cleanup_next_at=clock_timestamp()+interval '1 day' where reference_id<>(pg_temp.saved('third')->>'referenceId')::uuid;
select pg_temp.keep('claim',public.claim_cleanup_work());
select is(pg_temp.saved('claim')->>'jobId',pg_temp.saved('third')->>'referenceId','late upload after account deletion is claimed');
select is(public.cleanup_worker_step((pg_temp.saved('claim')->>'jobId')::uuid,'orphan_reference',(pg_temp.saved('claim')->>'claimToken')::uuid,'renew')->>'accepted','true','orphan lease works after account deletion');
select * from finish();
rollback;
