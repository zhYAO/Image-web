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

select ok(not has_function_privilege('authenticated','public.reconcile_reference_promotion_usage(uuid,text,uuid,bigint)','execute'),'byte reconciliation is restricted');
select is(pg_temp.promote()->>'size','68','lookup returns trusted Storage size bound');
select is((select sum(amount) from private.preview_usage_ledger where user_id=pg_temp.rid('owner') and metric='write' and state='committed'),1::numeric,'lookup binding admission consumes one committed write');
select is((select count(*) from private.preview_usage_ledger where metric='upload_bytes'),0::bigint,'binding admission does not charge upload bytes');
select pg_temp.promote();
select is((select count(*) from private.reference_promotion_requests),1::bigint,'same-key retry keeps one binding');
select is((select sum(amount) from private.preview_usage_ledger where user_id=pg_temp.rid('owner') and metric='write' and state='committed'),2::numeric,'repeat download admission remains bounded even when upload reservations release');
select throws_ok($$select pg_temp.promote('generation-2')$$,'23505','idempotency_conflict','live request key cannot change source');

-- Reject size problems before admitting full downloads or creating bindings.
update storage.objects set metadata='{"size":10485761}' where name='reference-test/generated-2';
select throws_ok($$select pg_temp.promote('generation-2','large')$$,'P0001','invalid_source_size','oversize Storage metadata fails closed');
update storage.objects set metadata='{}' where name='reference-test/generated-2';
select throws_ok($$select pg_temp.promote('generation-2','missing')$$,'P0001','invalid_source_size','missing Storage metadata fails closed');
update storage.objects set metadata='{"size":68}' where name='reference-test/generated-2';
select pg_temp.keep('first',pg_temp.promote('generation-1','request-1',pg_temp.meta()));
select throws_ok($$select pg_temp.promote('generation-1','pending-lookup')$$,'P0001','reference_in_progress','pending source rejected by lookup before any download');
select is((select count(*) from private.reference_promotion_requests where request_id=pg_temp.rid('pending-lookup')),0::bigint,'pending rejection does not persist a binding');
insert into storage.objects(bucket_id,name) values('uploads',pg_temp.saved('first')->>'storagePath');
select pg_temp.intent('first','finalize');
select pg_temp.keep('writes',to_jsonb((select sum(amount) from private.preview_usage_ledger where metric='write' and state='committed')));
select pg_temp.promote();
select is(to_jsonb((select sum(amount) from private.preview_usage_ledger where metric='write' and state='committed')),pg_temp.saved('writes'),'exact-key ready replay is free');
select pg_temp.promote('generation-1','reuse-new');
select is(to_jsonb((select sum(amount) from private.preview_usage_ledger where metric='write' and state='committed')),to_jsonb((pg_temp.saved('writes')::text)::integer+1),'new-key ready reuse is a guarded write');

-- Flooding ready reuse cannot generate permanent unmetered rows.
create function pg_temp.flood(n integer) returns integer language plpgsql as $$
declare accepted integer:=0; i integer;
begin
  for i in 1..n loop
    begin
      perform pg_temp.promote('generation-1','flood-'||i);
      accepted:=accepted+1;
    exception when raise_exception then
      if sqlerrm not like 'preview_quota_exceeded:%' then raise; end if;
    end;
  end loop;
  return accepted;
end;
$$;
delete from private.preview_usage_ledger where user_id=pg_temp.rid('owner');
delete from private.reference_promotion_requests where user_id=pg_temp.rid('owner');
select is(pg_temp.flood(100),60,'100 new reuse keys are limited to the existing 60 writes/hour');
select is((select count(*) from private.reference_promotion_requests),60::bigint,'only admitted requests persist');
select is((select count(*) from private.preview_usage_ledger where metric='upload_bytes'),0::bigint,'ready reuse flood does not reserve duplicate bytes');
select throws_ok($$select pg_temp.promote('generation-1','limit-61')$$,'P0001','preview_quota_exceeded:write_hour','new reuse key rejects at write quota');
select lives_ok($$select pg_temp.promote('generation-1','flood-1')$$,'exact replay still works at write quota');
select throws_ok($$select pg_temp.promote('generation-2','flood-1')$$,'23505','idempotency_conflict','quota exhaustion cannot change a bound source');

-- Expired keys are explicitly outside the 24-hour idempotency window. Admission
-- remains charged for a new binding, even if a UUID is reused after expiry.
delete from private.preview_usage_ledger where user_id=pg_temp.rid('owner');
update private.reference_promotion_requests set expires_at=clock_timestamp()-interval '1 second' where request_id=pg_temp.rid('flood-1');
select lives_ok($$select pg_temp.promote('generation-2','flood-1')$$,'expired binding can be admitted for a new source');
select is((select generation_id from private.reference_promotion_requests where request_id=pg_temp.rid('flood-1')),pg_temp.rid('generation-2'),'renewed key stores its new binding');
select is((select sum(amount) from private.preview_usage_ledger where metric='write'),1::numeric,'renewal does not reuse old admission ledger key');
select ok((select expires_at-created_at between interval '23 hours 59 minutes' and interval '24 hours 1 minute' from private.reference_promotion_requests where request_id=pg_temp.rid('flood-1')),'binding gets a fixed 24-hour lifetime');

-- A hard per-user bound is independent of hourly ledger window rollover.
insert into private.reference_promotion_requests(user_id,request_id,task_id,generation_id)
select pg_temp.rid('owner'),pg_temp.rid('retained-'||n),pg_temp.rid('task'),pg_temp.rid('generation-1') from generate_series(1,196) n;
select throws_ok($$select pg_temp.promote('generation-1','cap-257')$$,'P0001','preview_quota_exceeded:promotion_bindings','257th retained user binding rejected');
select lives_ok($$select pg_temp.promote('generation-1','flood-2')$$,'ready replay still works at binding cap');
update private.reference_promotion_requests set expires_at=clock_timestamp()-interval '1 second';
select public.claim_cleanup_work();
select is((select count(*) from private.reference_promotion_requests),56::bigint,'cleanup prunes expired request bindings in batches of 200');
select public.claim_cleanup_work();
select is((select count(*) from private.reference_promotion_requests),0::bigint,'next cleanup batch removes remaining expired bindings');
select ok(exists(select 1 from private.reference_write_intents where reference_id=(pg_temp.saved('first')->>'referenceId')::uuid),'binding maintenance never deletes write intents');

-- Capacity, even without a pending source, rejects a lookup before returning a key.
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
select pg_temp.rid('fill-'||n),pg_temp.rid('owner'),pg_temp.rid('session'),'fill/'||n,'reference.png','image/png',68,1,1 from generate_series(1,63) n;
select throws_ok($$select pg_temp.promote('generation-2','full-lookup')$$,'P0001','reference_capacity_64','full history rejects source lookup');

-- Reconciliation only reduces owned reserved bytes, retaining upload count and
-- admission throughout, and cannot change a committed/foreign reservation.
update private.runtime_flags set enabled=true where flag='upload_enabled';
select private.reserve_preview_usage(pg_temp.rid('owner'),'upload',1024,false,'promotion:reconcile',pg_temp.rid('correlation'));
select is(public.reconcile_reference_promotion_usage(pg_temp.rid('owner'),'promotion:reconcile',pg_temp.rid('correlation'),68),true,'actual small image reconciles reserved upper bound');
select is((select amount from private.preview_usage_ledger where business_key='promotion:reconcile' and metric='upload_bytes'),68::bigint,'actual bytes remain reserved');
select is((select amount from private.preview_usage_ledger where business_key='promotion:reconcile' and metric='upload_count'),1::bigint,'upload count remains reserved during reconciliation');
select throws_ok($$select public.reconcile_reference_promotion_usage(pg_temp.rid('owner'),'promotion:reconcile',pg_temp.rid('correlation'),1024)$$,'P0001','invalid_promotion_reservation','reconciliation cannot grow bytes beyond reservation');
select throws_ok($$select public.reconcile_reference_promotion_usage(pg_temp.rid('other'),'promotion:reconcile',pg_temp.rid('correlation'),1)$$,'P0001','invalid_promotion_reservation','reconciliation cannot touch another owner');
select private.commit_preview_usage(pg_temp.rid('owner'),'promotion:reconcile');
select throws_ok($$select public.reconcile_reference_promotion_usage(pg_temp.rid('owner'),'promotion:reconcile',pg_temp.rid('correlation'),1)$$,'P0001','invalid_promotion_reservation','committed bytes cannot be rewritten');

-- Task/account lifecycle deletes request bookkeeping but leaves late-object work.
select pg_temp.promote('generation-1','lifecycle');
insert into public.commerce_tasks(id,user_id,session_id) values(pg_temp.rid('surviving-task'),pg_temp.rid('owner'),pg_temp.rid('session'));
select throws_ok($$select public.promote_commerce_reference(pg_temp.rid('owner'),pg_temp.rid('surviving-task'),pg_temp.rid('lifecycle'),pg_temp.rid('generation-1'))$$,'23505','idempotency_conflict','same request key cannot switch tasks');
insert into private.reference_promotion_requests(user_id,request_id,task_id,generation_id)
values(pg_temp.rid('owner'),pg_temp.rid('account-lifecycle'),pg_temp.rid('surviving-task'),pg_temp.rid('generation-1'));
delete from public.commerce_tasks where id=pg_temp.rid('task');
select is((select count(*) from private.reference_promotion_requests where task_id=pg_temp.rid('task')),0::bigint,'task deletion cascades its request bindings');
select is((select count(*) from private.reference_promotion_requests),1::bigint,'other task binding remains until account deletion');
select ok(exists(select 1 from private.reference_write_intents),'task deletion preserves object intents');
delete from auth.users where id=pg_temp.rid('owner');
select is((select count(*) from private.reference_promotion_requests),0::bigint,'account deletion leaves no request bindings');
select ok(exists(select 1 from private.reference_write_intents),'account deletion preserves object intents');
select * from finish();
rollback;
