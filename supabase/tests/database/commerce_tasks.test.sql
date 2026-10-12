begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- All fixtures, simulated worker completions and injected failures roll back.
create function pg_temp.cid(label text) returns uuid language sql immutable as $$select md5('commerce-test:'||label)::uuid$$;
create temporary table commerce_test_state (key text primary key, value jsonb);
create function pg_temp.state(label text) returns jsonb language sql as $$select value from commerce_test_state where key=label$$;
create function pg_temp.keep(label text, data jsonb) returns void language sql as $$
  insert into commerce_test_state values(label,data) on conflict(key) do update set value=excluded.value;
$$;
create function pg_temp.commerce_plan(n integer default 2) returns jsonb language sql as $$
  select jsonb_build_object('scene','product-set','templateId','white-main','brief',jsonb_build_object(
    'name','Test product','facts','','sellingPoints','','platform','taobao','placement','main',
    'productReferenceIds',jsonb_build_array(pg_temp.cid('reference')),'styleReferenceIds','[]'::jsonb),
    'slots',(select jsonb_agg(jsonb_build_object('id',pg_temp.cid('slot-'||i),'role','Product '||i,
      'instruction','','exactText','','referenceIds',jsonb_build_array(pg_temp.cid('reference')),
      'provider','seedream','model','doubao-seedream-5.0-pro','aspectRatio','1:1','resolution','2K') order by i)
      from generate_series(1,n) i));
$$;
create function pg_temp.commerce_compile(plan jsonb) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('slotId',s->>'id','prompt','Compiled '||(s->>'role'),
    'hash',md5((plan->'brief')::text||s::text),'provider',s->>'provider','model',s->>'model',
    'templateVersion','1.0.0','compilerVersion','commerce-1','config',jsonb_build_object(
      'aspectRatio',s->>'aspectRatio','resolution',s->>'resolution','count',1,
      'referenceIds',s->'referenceIds','registryVersion','2026-10-12.1')))
    from jsonb_array_elements(plan->'slots') s;
$$;
create function pg_temp.commerce_call(op text, body jsonb default '{}'::jsonb, target uuid default null,
  owner_uuid uuid default pg_temp.cid('owner'), hash_override text default null) returns jsonb language plpgsql as $$
declare input jsonb := body; task_uuid uuid;
begin
  task_uuid := case when op in ('create','list') then target else coalesce(target,(pg_temp.state('created')->>'id')::uuid) end;
  if op not in ('get','list') and not input ? 'requestId' then input := input||jsonb_build_object('requestId',gen_random_uuid()); end if;
  return public.commerce_dispatch(owner_uuid,op,task_uuid,input,
    coalesce(hash_override,md5(owner_uuid::text||op||coalesce(task_uuid::text,'')||input::text)),
    case when op in ('create','save') then pg_temp.commerce_compile(input->'plan') else null end,gen_random_uuid());
end;
$$;
create function pg_temp.complete_commerce(generation_uuid uuid) returns void language sql as $$
  update public.generations set status='succeeded',provider_submission_state='submitted',storage_bucket='generated',
    storage_path='commerce-test/'||id,asset_status='active',asset_expires_at=now()+interval '1 day',error_code=null
    where id=generation_uuid;
$$;

insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  (pg_temp.cid('owner'),'commerce-owner@example.com',now(),false),
  (pg_temp.cid('other'),'commerce-other@example.com',now(),false),
  (pg_temp.cid('unverified'),'commerce-unverified@example.com',null,false);
insert into auth.sessions(id,user_id) values(pg_temp.cid('login'),pg_temp.cid('owner'));
insert into public.sessions(id,user_id,title) values
  (pg_temp.cid('session'),pg_temp.cid('owner'),'Commerce'),
  (pg_temp.cid('second-session'),pg_temp.cid('owner'),'Other session'),
  (pg_temp.cid('other-session'),pg_temp.cid('other'),'Other owner');
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
  values(pg_temp.cid('reference'),pg_temp.cid('owner'),pg_temp.cid('session'),
    pg_temp.cid('owner')||'/'||pg_temp.cid('session')||'/commerce.webp','commerce.webp','image/webp',10,1,1);
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='seedream';
delete from private.provider_health_windows where provider='seedream';

select has_function('public','commerce_dispatch',array['uuid','text','uuid','jsonb','text','jsonb','uuid'],'exact public dispatcher signature');
select ok(not has_function_privilege('anon','public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid)','execute'),'anon cannot dispatch');
select ok(not has_function_privilege('authenticated','public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid)','execute'),'authenticated cannot spoof service identity');
select ok(has_function_privilege('service_role','public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid)','execute'),'service may dispatch');
select ok(not has_function_privilege('authenticated','private.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid)','execute'),'private implementation restricted');
select ok(not has_function_privilege('service_role','private.commerce_task_json(uuid)','execute'),'service cannot bypass live owner checks through projection helper');
select ok(not has_table_privilege('authenticated','private.commerce_compiled_slots','select'),'compiled prompts stay private');
select ok(not has_table_privilege('service_role','public.commerce_tasks','insert'),'even service writes use dispatcher');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname like 'commerce_%'
  and c.relkind='r' and n.nspname in ('public','private') and not c.relrowsecurity),0::bigint,'all commerce data has RLS');
select ok(has_function_privilege('service_role','public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)','execute'),'old submit RPC preserved');

select pg_temp.keep('create-input',jsonb_build_object('requestId',pg_temp.cid('create'),'sessionId',pg_temp.cid('session'),'plan',pg_temp.commerce_plan()));
select pg_temp.keep('created',pg_temp.commerce_call('create',pg_temp.state('create-input')));
select is(pg_temp.state('created')->>'revision','1','create starts revision one');
select is(pg_temp.state('created')->'runs','[]'::jsonb,'create does not generate');
select is(pg_temp.commerce_call('create',pg_temp.state('create-input')),pg_temp.state('created'),'create idempotence stores exact result');
select is(jsonb_array_length(pg_temp.commerce_call('list',jsonb_build_object('sessionId',pg_temp.cid('session')))),1,'list scoped to same session');
select is((select count(*) from public.generation_batches where user_id=pg_temp.cid('owner')),0::bigint,'planning charges no children');
select is((select plan from public.commerce_revisions where task_id=(pg_temp.state('created')->>'id')::uuid),pg_temp.commerce_plan(),'revision contains raw plan');
select ok(not (pg_temp.state('created')::text like '%Compiled %'),'projection excludes executable compiled prompt');
select is((select count(*) from jsonb_object_keys(pg_temp.state('created')->'slotHashes')),2::bigint,'current compiled slot hashes returned');
select throws_ok($$select pg_temp.commerce_call('create',pg_temp.state('create-input'),null,pg_temp.cid('owner'),'changed')$$,
  '23505','idempotency_conflict','same key different hash conflicts');
select throws_ok($$select pg_temp.commerce_call('get','{}',null,pg_temp.cid('other'))$$,'42501','task_not_found','cross-owner task blocked');
select throws_ok($$select pg_temp.commerce_call('list',jsonb_build_object('sessionId',pg_temp.cid('session')),null,pg_temp.cid('other'))$$,
  '42501','session_not_found','cross-owner list blocked');
select throws_ok($$select pg_temp.commerce_call('get','{}',null,pg_temp.cid('unverified'))$$,'42501','unauthorized','unverified account blocked before lookup');

-- Drafts accept empty references; SUBMIT, not SAVE, enforces usable product data.
select pg_temp.keep('draft-plan',jsonb_set(jsonb_set(pg_temp.commerce_plan(1),'{brief,productReferenceIds}','[]'),'{slots,0,referenceIds}','[]'));
select pg_temp.keep('draft',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.state('draft-plan'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('draft')->>'id')::uuid)$$,
  '22023','commerce_brief_incomplete','empty draft cannot execute');
select throws_ok($$select public.commerce_dispatch(pg_temp.cid('owner'),'create',null,pg_temp.state('create-input')||jsonb_build_object('requestId',gen_random_uuid()),'bad-count',
  jsonb_set(pg_temp.commerce_compile(pg_temp.commerce_plan()),'{0,config,count}','2'),gen_random_uuid())$$,
  '22023','invalid_commerce_compiled','trusted compiled boundary still enforces count one');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'),pg_temp.cid('slot-1'))))$$,
  '22023','invalid_commerce_slots','duplicate selected slots rejected');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds','[]'::jsonb))$$,
  '22023','invalid_commerce_slots','empty selected slots rejected');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('unknown-slot'))))$$,
  '22023','invalid_commerce_slots','nonmember selected slot rejected');
select pg_temp.keep('combined-plan',jsonb_set(pg_temp.commerce_plan(1),'{brief,styleReferenceIds}',
  jsonb_build_array(pg_temp.cid('reference'),pg_temp.cid('r2'),pg_temp.cid('r3'),pg_temp.cid('r4'))));
select pg_temp.keep('combined-task',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.state('combined-plan'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('combined-task')->>'id')::uuid)$$,
  '22023','invalid_references','product and style references have combined four limit');
update public.reference_uploads set upload_expires_at=now()-interval '1 second' where id=pg_temp.cid('reference');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  '22023','reference_expired_or_forbidden','references revalidated at submit time');
update public.reference_uploads set upload_expires_at=now()+interval '1 day' where id=pg_temp.cid('reference');
select pg_temp.keep('cross-session',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('second-session'),'plan',pg_temp.commerce_plan(1))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('cross-session')->>'id')::uuid)$$,
  '22023','reference_expired_or_forbidden','same-owner cross-session reference blocked');
select pg_temp.keep('other-owner',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('other-session'),'plan',pg_temp.commerce_plan(1)),null,pg_temp.cid('other')));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('other-owner')->>'id')::uuid,pg_temp.cid('other'))$$,
  '22023','reference_expired_or_forbidden','cross-owner reference blocked');
update private.runtime_flags set enabled=false where flag='generation_enabled';
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  'P0001','feature_disabled:generation','commerce cannot bypass emergency stop');
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=false where provider='seedream';
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  'P0001','provider_unavailable','commerce cannot bypass disabled provider');
update private.provider_runtime_config set enabled=true where provider='seedream';

-- Fail after the first child's durable queue/quota writes, at child two.
create function pg_temp.commerce_fail_second() returns trigger language plpgsql as $$
begin if new.prompt='Compiled Product 2' then raise exception 'commerce_test_child_two_failed'; end if; return new; end;
$$;
create trigger commerce_test_fail_second before insert on public.generation_batches for each row execute function pg_temp.commerce_fail_second();
select pg_temp.keep('queue-before',to_jsonb((select count(*) from pgmq.q_image_generation)));
select pg_temp.keep('preview-before-fault',to_jsonb((select count(*) from private.preview_usage_ledger where user_id=pg_temp.cid('owner'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'),pg_temp.cid('slot-2'))))$$,
  'P0001','commerce_test_child_two_failed','second-child fault aborts group');
select is((select count(*) from public.commerce_runs),0::bigint,'failed group leaves no run');
select is((select count(*) from public.generation_batches where user_id=pg_temp.cid('owner')),0::bigint,'first child batch rolled back');
select is((select count(*) from private.quota_ledger where user_id=pg_temp.cid('owner')),0::bigint,'first child quota rolled back');
select is(to_jsonb((select count(*) from private.preview_usage_ledger where user_id=pg_temp.cid('owner'))),pg_temp.state('preview-before-fault'),'first child preview commit rolled back');
select is(to_jsonb((select count(*) from pgmq.q_image_generation)),pg_temp.state('queue-before'),'first child durable queue send rolled back');
drop trigger commerce_test_fail_second on public.generation_batches;

select pg_temp.keep('submit-input',jsonb_build_object('requestId',pg_temp.cid('submit'),'revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'),pg_temp.cid('slot-2'))));
select pg_temp.keep('submitted',pg_temp.commerce_call('submit',pg_temp.state('submit-input')));
select is(jsonb_array_length(pg_temp.state('submitted')#>'{runs,0,items}'),2,'one run groups two different single-image children');
select is((select count(*) from public.sessions where user_id=pg_temp.cid('owner')),2::bigint,'run grouping never creates a second session');
select is((select sum(amount)::bigint from private.quota_ledger where user_id=pg_temp.cid('owner') and entry_type='reserve'),2::bigint,'quota charged only once per child');
select is((select count(*) from private.preview_usage_ledger where user_id=pg_temp.cid('owner') and operation='generation' and metric='write' and state='committed'),2::bigint,'each child passes and commits preview guard');
select ok(not exists(select 1 from public.commerce_run_items i join public.generation_batches b on b.id=i.batch_id
  where b.idempotency_key <> i.run_id::text||':'||i.slot_id::text or b.config->>'count' <> '1'),'child key is runId:slotId with count one');
select is(pg_temp.commerce_call('submit',pg_temp.state('submit-input')),pg_temp.state('submitted'),'identical submit returns persisted operation result');
select throws_ok($$select pg_temp.commerce_call('submit',pg_temp.state('submit-input'),(pg_temp.state('draft')->>'id')::uuid,
  pg_temp.cid('owner'),md5(pg_temp.cid('owner')::text||'submit'||(pg_temp.state('created')->>'id')||pg_temp.state('submit-input')::text))$$,
  '23505','idempotency_conflict','task binding prevents same-key replay against another owned task even with the old hash');
select throws_ok($$select pg_temp.commerce_call('submit',pg_temp.state('submit-input')||jsonb_build_object('requestId',gen_random_uuid()))$$,
  '40001','commerce_slot_active','different request cannot race an already active slot');
select pg_temp.keep('first-generation',pg_temp.state('submitted')#>'{runs,0,items,0,generationId}');
select pg_temp.keep('second-generation',pg_temp.state('submitted')#>'{runs,0,items,1,generationId}');

select pg_temp.keep('save-input',jsonb_build_object('requestId',pg_temp.cid('save'),'expectedRevision',1,
  'plan',jsonb_set(pg_temp.commerce_plan(),'{slots,0,instruction}','"Change background"')));
select pg_temp.keep('saved',pg_temp.commerce_call('save',pg_temp.state('save-input')));
select is(pg_temp.state('saved')->>'revision','2','save advances immutable revision');
select is(pg_temp.commerce_call('save',pg_temp.state('save-input')),pg_temp.state('saved'),'same save deduplicates after revision advances');
select is(pg_temp.commerce_call('submit',pg_temp.state('submit-input')),pg_temp.state('submitted'),'same submit deduplicates even after revision moved');
select throws_ok($$select pg_temp.commerce_call('save',pg_temp.state('save-input')||jsonb_build_object('requestId',gen_random_uuid()))$$,
  '40001','revision_conflict','new stale save conflicts');
select throws_ok($$select pg_temp.commerce_call('submit',pg_temp.state('submit-input')||jsonb_build_object('requestId',gen_random_uuid()))$$,
  '40001','revision_conflict','new stale submit conflicts before children');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'recreate',true,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  '40001','commerce_slot_active','active slot blocks across saved revisions even for explicit recreate');
select pg_temp.complete_commerce((pg_temp.state('first-generation')#>>'{}')::uuid);
select pg_temp.complete_commerce((pg_temp.state('second-generation')#>>'{}')::uuid);
select pg_temp.keep('after-completion',pg_temp.commerce_call('get'));
select is(jsonb_array_length(pg_temp.state('after-completion')->'selections'),1,'late changed-slot result stays history, untouched slot inherits');
select is(pg_temp.state('after-completion')#>>'{selections,0,slotId}',pg_temp.cid('slot-2')::text,'only compatible pending candidate auto-adopted');
select is(pg_temp.state('after-completion')#>>'{runs,0,items,0,status}','succeeded','run statuses join actual generation state');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'slotIds',jsonb_build_array(pg_temp.cid('slot-2'))))$$,
  '40001','commerce_recreate_required','inherited successful slot requires explicit recreation');

-- A manual selection during a redo protects it from later automatic adoption.
select pg_temp.keep('redo',pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'recreate',true,'slotIds',jsonb_build_array(pg_temp.cid('slot-2')))));
select pg_temp.keep('redo-generation',pg_temp.state('redo')#>'{runs,1,items,0,generationId}');
select pg_temp.keep('select-input',jsonb_build_object('requestId',pg_temp.cid('select'),'revision',2,'slotId',pg_temp.cid('slot-2'),
  'generationId',pg_temp.state('second-generation'),'expectedSelectionVersion',0));
select pg_temp.keep('selected',pg_temp.commerce_call('select',pg_temp.state('select-input')));
select is(pg_temp.state('selected')#>>'{selections,0,version}','1','manual selection increments version');
select is(pg_temp.commerce_call('select',pg_temp.state('select-input')),pg_temp.state('selected'),'manual selection retry does not increment version again');
select throws_ok($$select pg_temp.commerce_call('select',pg_temp.state('select-input')||jsonb_build_object('requestId',gen_random_uuid()))$$,
  '40001','selection_conflict','stale manual selection loses version race');
select pg_temp.complete_commerce((pg_temp.state('redo-generation')#>>'{}')::uuid);
select pg_temp.keep('manual-protected',pg_temp.commerce_call('get'));
select is(pg_temp.state('manual-protected')#>'{selections,0,generationId}',pg_temp.state('second-generation'),'late redo cannot overwrite a manual selection');
select throws_ok($$select pg_temp.commerce_call('select',jsonb_build_object('revision',2,'slotId',pg_temp.cid('slot-1'),
  'generationId',pg_temp.state('second-generation'),'expectedSelectionVersion',0))$$,
  '22023','commerce_generation_unavailable','same-task wrong-slot generation cannot be selected');

select pg_temp.keep('export-input',jsonb_build_object('requestId',pg_temp.cid('export'),'revision',2,'selections',jsonb_build_array(
  jsonb_build_object('slotId',pg_temp.cid('slot-2'),'generationId',pg_temp.state('second-generation')))));
select pg_temp.keep('exported',pg_temp.commerce_call('export',pg_temp.state('export-input')));
select is(pg_temp.state('exported')->'items',pg_temp.state('export-input')->'selections','export freezes explicit ordered IDs');
select ok(not (pg_temp.state('exported')::text like '%url%'),'SQL export contains no URLs');
select throws_ok($$select pg_temp.commerce_call('export',jsonb_build_object('revision',2,'selections',jsonb_build_array(
  jsonb_build_object('slotId',pg_temp.cid('slot-1'),'generationId',pg_temp.state('second-generation')))))$$,
  '22023','commerce_generation_unavailable','export rejects a generation belonging to another slot');
select throws_ok($$select pg_temp.commerce_call('export',jsonb_build_object('revision',1,'selections',jsonb_build_array(
  jsonb_build_object('slotId',pg_temp.cid('slot-1'),'generationId',pg_temp.state('first-generation')))),(pg_temp.state('draft')->>'id')::uuid)$$,
  '22023','commerce_generation_unavailable','export rejects a same-owner generation from another task');
select throws_ok($$select pg_temp.commerce_call('export',pg_temp.state('export-input')||jsonb_build_object('requestId',gen_random_uuid(),
  'selections',(pg_temp.state('export-input')->'selections')||(pg_temp.state('export-input')->'selections')))$$,
  '22023','invalid_commerce_export','export rejects duplicate slot mappings');
select pg_temp.commerce_call('select',pg_temp.state('select-input')||jsonb_build_object('requestId',gen_random_uuid(),
  'expectedSelectionVersion',1,'generationId',pg_temp.state('redo-generation')));
select is(pg_temp.commerce_call('export',pg_temp.state('export-input')),pg_temp.state('exported'),'export stays frozen after a later selection');
update public.generations set asset_status='expired',asset_expires_at=now()-interval '1 second' where id=(pg_temp.state('second-generation')#>>'{}')::uuid;
select throws_ok($$select pg_temp.commerce_call('export',pg_temp.state('export-input')||jsonb_build_object('requestId',gen_random_uuid()))$$,
  '22023','commerce_generation_unavailable','new export revalidates expiration');
select is(pg_temp.commerce_call('export',pg_temp.state('export-input')),pg_temp.state('exported'),'same export retry returns IDs after expiry for HTTP hydration');

-- Unknown/provider storage outcomes remain blocked even when UI says failed.
select pg_temp.keep('new-slot-one',pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'slotIds',jsonb_build_array(pg_temp.cid('slot-1')))));
select pg_temp.keep('unknown-generation',pg_temp.state('new-slot-one')#>'{runs,2,items,0,generationId}');
update public.generations set status='failed',provider_submission_state='unknown',error_code='provider_reconciliation_required'
  where id=(pg_temp.state('unknown-generation')#>>'{}')::uuid;
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'recreate',true,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  '40001','commerce_slot_active','unknown failed item cannot be reissued');
update public.generations set provider_submission_state='submitted',error_code='result_storage_failed'
  where id=(pg_temp.state('unknown-generation')#>>'{}')::uuid;
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'recreate',true,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))))$$,
  '40001','commerce_slot_active','pending-storage failed item cannot be reissued');
select pg_temp.keep('quota-before-archive',to_jsonb((select sum(amount) from private.quota_ledger where user_id=pg_temp.cid('owner') and entry_type='reserve')));
select pg_temp.keep('archived',pg_temp.commerce_call('archive',jsonb_build_object('revision',2)));
select is(pg_temp.state('archived')->>'archived','true','archive only changes planning lifecycle');
select is(to_jsonb((select sum(amount) from private.quota_ledger where user_id=pg_temp.cid('owner') and entry_type='reserve')),
  pg_temp.state('quota-before-archive'),'archive never refunds paid children');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',2,'recreate',true,'slotIds',jsonb_build_array(pg_temp.cid('slot-2'))))$$,
  'P0001','task_archived','archived tasks cannot enqueue');
select pg_temp.complete_commerce((pg_temp.state('unknown-generation')#>>'{}')::uuid);
select is(jsonb_array_length(pg_temp.commerce_call('get')->'selections'),2,'archived task still adopts a paid in-flight success');

-- Real per-child preview/day limits must roll back all earlier children.
select pg_temp.keep('limit-task',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.commerce_plan(8))));
insert into private.preview_usage_ledger(user_id,operation,metric,amount,state,business_key,correlation_id)
  select pg_temp.cid('owner'),'session_update','write',59-coalesce(sum(amount),0),'committed','commerce-test-fill-hour',gen_random_uuid()
  from private.preview_usage_ledger where user_id=pg_temp.cid('owner') and metric='write' and state<>'released';
select pg_temp.keep('batches-before-limit',to_jsonb((select count(*) from public.generation_batches where user_id=pg_temp.cid('owner'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'),pg_temp.cid('slot-2'))),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','second child cannot bypass hourly preview limit');
select is(to_jsonb((select count(*) from public.generation_batches where user_id=pg_temp.cid('owner'))),pg_temp.state('batches-before-limit'),'preview rejection rolls back earlier child');
select is((select sum(amount) from private.preview_usage_ledger where user_id=pg_temp.cid('owner') and metric='write' and state<>'released'),59::numeric,'preview reservation rollback restores budget');
delete from private.preview_usage_ledger where business_key='commerce-test-fill-hour' and user_id=pg_temp.cid('owner');
insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key)
  select pg_temp.cid('owner'),(select batch_id from public.generations where id=(pg_temp.state('first-generation')#>>'{}')::uuid),
    (pg_temp.state('first-generation')#>>'{}')::uuid,'reserve',29-sum(case when entry_type='reserve' then amount when entry_type='release' then -amount else 0 end),
    'commerce-test-fill-day' from private.quota_ledger where user_id=pg_temp.cid('owner');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'),pg_temp.cid('slot-2'))),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','quota_exceeded','second child cannot bypass daily generation limit');
select is(to_jsonb((select count(*) from public.generation_batches where user_id=pg_temp.cid('owner'))),pg_temp.state('batches-before-limit'),'daily quota rejection rolls back first child');
delete from private.quota_ledger where business_key='commerce-test-fill-day';

select pg_temp.keep('eight-run',pg_temp.commerce_call('submit',jsonb_build_object('revision',1,
  'slotIds',(select jsonb_agg(pg_temp.cid('slot-'||i) order by i) from generate_series(1,8) i)),(pg_temp.state('limit-task')->>'id')::uuid));
select is(jsonb_array_length(pg_temp.state('eight-run')#>'{runs,0,items}'),8,'eight slots execute as eight count-one children');
select pg_temp.keep('cancel-input',jsonb_build_object('requestId',pg_temp.cid('cancel'),'revision',1,'runId',pg_temp.state('eight-run')#>'{runs,0,id}'));
select pg_temp.keep('cancel-generation',pg_temp.state('eight-run')#>'{runs,0,items,0,generationId}');
update public.generations set status='processing' where id=(pg_temp.state('cancel-generation')#>>'{}')::uuid;
update public.generations set provider_submission_state='unknown' where id=(pg_temp.state('eight-run')#>>'{runs,0,items,1,generationId}')::uuid;
select pg_temp.keep('cancelled',pg_temp.commerce_call('cancel',pg_temp.state('cancel-input'),(pg_temp.state('limit-task')->>'id')::uuid));
select is(pg_temp.commerce_call('cancel',pg_temp.state('cancel-input'),(pg_temp.state('limit-task')->>'id')::uuid),pg_temp.state('cancelled'),'cancel exact retry deduplicates');
select is((select status from public.generations where id=(pg_temp.state('cancel-generation')#>>'{}')::uuid),'processing',
  'cancellation preserves processing claims even before provider submission');
select is((select provider_submission_state from public.generations where id=(pg_temp.state('eight-run')#>>'{runs,0,items,1,generationId}')::uuid),'unknown',
  'cancellation preserves unknown submissions with a pending status');
select is((select count(*) from private.quota_ledger q join public.commerce_run_items i on i.generation_id=q.generation_id
  where i.run_id=(pg_temp.state('eight-run')#>>'{runs,0,id}')::uuid and q.entry_type='release'),6::bigint,'partial cancellation releases only eligible pending children once');
select is((select count(*) from pgmq.q_image_generation q join public.commerce_run_items i on i.generation_id::text=q.message->>'generationId'
  where i.run_id=(pg_temp.state('eight-run')#>>'{runs,0,id}')::uuid),2::bigint,'partial cancellation leaves active sibling queue messages intact');
select is((select count(*) from public.generations g join public.commerce_run_items i on i.generation_id=g.id
  where i.run_id=(pg_temp.state('eight-run')#>>'{runs,0,id}')::uuid and g.status='failed' and g.error_code='user_cancelled'),6::bigint,'cancelled items report user_cancelled');
select throws_ok($$select pg_temp.commerce_call('cancel',pg_temp.state('cancel-input')||jsonb_build_object('requestId',gen_random_uuid()),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  '40001','commerce_cancel_conflict','no eligible pending items returns conflict without touching processing or unknown work');
-- Simulate an ordinary safe retry into pending and a resolved not-submitted item.
update public.generations set status='pending',provider_submission_state='not_submitted'
  where id in ((pg_temp.state('cancel-generation')#>>'{}')::uuid,(pg_temp.state('eight-run')#>>'{runs,0,items,1,generationId}')::uuid);
select pg_temp.keep('cancelled-rest',pg_temp.commerce_call('cancel',pg_temp.state('cancel-input')||jsonb_build_object('requestId',gen_random_uuid()),(pg_temp.state('limit-task')->>'id')::uuid));
select is((select count(*) from private.quota_ledger q join public.commerce_run_items i on i.generation_id=q.generation_id
  where i.run_id=(pg_temp.state('eight-run')#>>'{runs,0,id}')::uuid and q.entry_type='release'),8::bigint,'later cancellation releases remaining safe items without duplicate release');
select is((select count(*) from pgmq.q_image_generation q join public.commerce_run_items i on i.generation_id::text=q.message->>'generationId'
  where i.run_id=(pg_temp.state('eight-run')#>>'{runs,0,id}')::uuid),0::bigint,'all cancelled children are archived');
select is(pg_temp.commerce_call('cancel',pg_temp.state('cancel-input'),(pg_temp.state('limit-task')->>'id')::uuid),pg_temp.state('cancelled'),'earlier cancel request remains a frozen operation result');
-- A superseded failed attempt that reports success late is history only.
select pg_temp.keep('candidate-one',pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'recreate',true,
  'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('limit-task')->>'id')::uuid));
select pg_temp.keep('candidate-one-id',pg_temp.state('candidate-one')#>'{runs,1,items,0,generationId}');
update public.generations set status='failed',error_code='provider_rejected',provider_submission_state='not_submitted'
  where id=(pg_temp.state('candidate-one-id')#>>'{}')::uuid;
select pg_temp.keep('candidate-two',pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'recreate',true,
  'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('limit-task')->>'id')::uuid));
select pg_temp.keep('candidate-two-id',pg_temp.state('candidate-two')#>'{runs,2,items,0,generationId}');
select pg_temp.complete_commerce((pg_temp.state('candidate-one-id')#>>'{}')::uuid);
select is(jsonb_array_length(pg_temp.commerce_call('get','{}',(pg_temp.state('limit-task')->>'id')::uuid)->'selections'),0,
  'superseded attempt cannot auto-adopt while newer candidate is pending');
select pg_temp.complete_commerce((pg_temp.state('candidate-two-id')#>>'{}')::uuid);
select is(pg_temp.commerce_call('get','{}',(pg_temp.state('limit-task')->>'id')::uuid)#>'{selections,0,generationId}',
  pg_temp.state('candidate-two-id'),'latest compatible successful candidate auto-adopts');
select pg_temp.keep('candidate-three',pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'recreate',true,
  'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('limit-task')->>'id')::uuid));
update public.generations set status='failed',error_code='provider_rejected',provider_submission_state='not_submitted'
  where id=(pg_temp.state('candidate-three')#>>'{runs,3,items,0,generationId}')::uuid;
select is(pg_temp.commerce_call('get','{}',(pg_temp.state('limit-task')->>'id')::uuid)#>'{selections,0,generationId}',
  pg_temp.state('candidate-two-id'),'failed newer candidate preserves the prior successful selection');
select pg_temp.keep('later-context',pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'recreate',true,
  'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('limit-task')->>'id')::uuid));
select throws_ok($$select pg_temp.commerce_call('cancel',pg_temp.state('cancel-input')||jsonb_build_object('requestId',gen_random_uuid()),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  '40001','commerce_cancel_conflict','cancel of an old finished run does not target a later run');
select is((select status from public.generations where id=(pg_temp.state('later-context')#>>'{runs,4,items,0,generationId}')::uuid),
  'pending','later run context remains active');
select throws_ok($$select pg_temp.commerce_call('cancel',pg_temp.state('cancel-input')||jsonb_build_object('requestId',gen_random_uuid(),'revision',2),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  '40001','revision_conflict','cancel protects current task revision');
select throws_ok($$select pg_temp.commerce_call('cancel',pg_temp.state('cancel-input')||jsonb_build_object('requestId',gen_random_uuid(),'runId',pg_temp.state('submitted')#>'{runs,0,id}'),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  '22023','commerce_run_not_found','cancel validates run membership even for another owned task');
set local role service_role;
select is(jsonb_array_length(public.commerce_dispatch(pg_temp.cid('owner'),'list',null,
  jsonb_build_object('sessionId',pg_temp.cid('session')),null,'[]',null)),4,'actual service role can call invoker wrapper and private definer');
reset role;

-- Ownership/liveness is checked before serving ANY saved operation result.
update public.account_profiles set status='deleting' where user_id=pg_temp.cid('owner');
select throws_ok($$select pg_temp.commerce_call('create',pg_temp.state('create-input'))$$,'42501','unauthorized','deleting account cannot replay create');
select throws_ok($$select pg_temp.commerce_call('submit',pg_temp.state('submit-input'))$$,'42501','unauthorized','deleting account cannot replay submit');
update public.account_profiles set status='active' where user_id=pg_temp.cid('owner');
update public.sessions set status='deleting',deleted_at=now() where id=pg_temp.cid('session');
select throws_ok($$select pg_temp.commerce_call('export',pg_temp.state('export-input'))$$,'42501','session_not_found','inactive session cannot replay export');
update public.sessions set status='active',deleted_at=null where id=pg_temp.cid('session');

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cid('owner'),'role','authenticated','session_id',pg_temp.cid('login'))::text,true);
set local role authenticated;
select is((select count(*) from public.commerce_tasks),5::bigint,'RLS shows owner tasks only');
select is((select count(*) from public.commerce_revisions),6::bigint,'revision RLS follows task ownership');
select throws_ok($$select public.commerce_dispatch(null,'list',null,'{}',null,null,null)$$,'42501',null,'authenticated cannot invoke wrapper');
reset role;
delete from auth.sessions where id=pg_temp.cid('login');
set local role authenticated;
select throws_ok($$select count(*) from public.commerce_tasks$$,'P0001','unauthorized','revoked auth session cannot read RLS data');
reset role;

-- A yesterday reservation cancelled today must not credit today's budget.
-- Insert a genuinely old fixture instead of rewriting immutable ledger facts.
select pg_temp.keep('prior-day-task',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.commerce_plan(1))));
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash,created_at)
  values(pg_temp.cid('prior-day-batch'),pg_temp.cid('owner'),pg_temp.cid('session'),'direct','Yesterday pending product','seedream','doubao-seedream-5.0-pro',
    '{"count":1,"aspectRatio":"1:1","resolution":"2K"}',pg_temp.cid('prior-day-run')||':'||pg_temp.cid('slot-1'),'yesterday-hash',
    (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 hour');
insert into public.generations(id,batch_id,provider,model,prompt,params,created_at)
  select pg_temp.cid('prior-day-generation'),id,provider,model,prompt,config,created_at from public.generation_batches where id=pg_temp.cid('prior-day-batch');
insert into private.quota_ledger(user_id,batch_id,generation_id,entry_type,amount,business_key,created_at)
  select pg_temp.cid('owner'),batch_id,id,'reserve',1,'reserve:'||id,created_at from public.generations where id=pg_temp.cid('prior-day-generation');
insert into public.commerce_runs(id,task_id,revision,request_id)
  values(pg_temp.cid('prior-day-run'),(pg_temp.state('prior-day-task')->>'id')::uuid,1,pg_temp.cid('prior-day-submit'));
insert into public.commerce_run_items(run_id,task_id,slot_id,position,batch_id,generation_id,compatibility_hash,selection_version)
  values(pg_temp.cid('prior-day-run'),(pg_temp.state('prior-day-task')->>'id')::uuid,pg_temp.cid('slot-1'),1,pg_temp.cid('prior-day-batch'),
    pg_temp.cid('prior-day-generation'),pg_temp.state('prior-day-task')->'slotHashes'->>pg_temp.cid('slot-1')::text,0);
select pgmq.send('image_generation',jsonb_build_object('generationId',pg_temp.cid('prior-day-generation')));
select pg_temp.keep('today-quota-before-old-cancel',private.get_user_quota(pg_temp.cid('owner')));
select pg_temp.keep('prior-day-cancelled',pg_temp.commerce_call('cancel',jsonb_build_object('revision',1,'runId',pg_temp.cid('prior-day-run')),
  (pg_temp.state('prior-day-task')->>'id')::uuid));
select is(private.get_user_quota(pg_temp.cid('owner')),pg_temp.state('today-quota-before-old-cancel'),'yesterday reserve then today cancel leaves today used quota unchanged');
select is((select created_at from private.quota_ledger where business_key='release:'||pg_temp.cid('prior-day-generation')),
  (select created_at from private.quota_ledger where business_key='reserve:'||pg_temp.cid('prior-day-generation')),
  'commerce release retains the original reservation accounting timestamp');
select ok((select updated_at >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') from public.generations where id=pg_temp.cid('prior-day-generation'))
  and (pg_temp.state('prior-day-cancelled')->>'updatedAt')::timestamptz >= (date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
  'generation and task timestamps still record actual cancellation today');

create function pg_temp.commerce_preflight(op text,body jsonb,target uuid default null,owner_uuid uuid default pg_temp.cid('owner'))
returns jsonb language sql as $$
  select public.commerce_dispatch(owner_uuid,op,target,body,
    md5(owner_uuid::text||op||coalesce(target::text,'')||body::text),null,gen_random_uuid());
$$;
create function pg_temp.commerce_footprint() returns jsonb language sql as $$
  select jsonb_build_object(
    'tasks',(select jsonb_agg(to_jsonb(t) order by t.id) from public.commerce_tasks t),
    'selections',(select jsonb_agg(to_jsonb(s) order by s.task_id,s.slot_id) from public.commerce_selections s),
    'revisions',(select count(*) from public.commerce_revisions),
    'compiled',(select count(*) from private.commerce_compiled_slots),
    'runs',(select count(*) from public.commerce_runs),'items',(select count(*) from public.commerce_run_items),
    'exports',(select count(*) from public.commerce_exports),'results',(select count(*) from private.commerce_operation_results),
    'preview',(select jsonb_agg(to_jsonb(p) order by p.id) from private.preview_usage_ledger p),
    'quota',(select jsonb_agg(to_jsonb(q) order by q.id) from private.quota_ledger q));
$$;
select is((select count(*) from private.preview_usage_ledger where user_id=pg_temp.cid('owner')
  and business_key='commerce:create:'||pg_temp.cid('create') and metric='write' and state='committed'),1::bigint,
  'create commits exactly one planning write without a session/image unit');
select is((select count(*) from private.preview_usage_ledger where user_id=pg_temp.cid('owner')
  and business_key='commerce:submit:'||pg_temp.cid('submit')),0::bigint,'submit has no duplicate operation-level write debit');
select pg_temp.keep('preflight-create-input',jsonb_build_object('requestId',pg_temp.cid('preflight-miss'),'sessionId',pg_temp.cid('session'),'plan','not a valid plan'));
select pg_temp.keep('preflight-save-input',jsonb_build_object('requestId',pg_temp.cid('preflight-save-miss'),'expectedRevision','not a number','plan','not a valid plan'));
select pg_temp.keep('before-preflight',pg_temp.commerce_footprint());
select is(pg_temp.commerce_preflight('create',pg_temp.state('preflight-create-input')),null::jsonb,'SQL NULL compiled create preflight miss returns SQL NULL before plan validation');
select is(pg_temp.commerce_preflight('save',pg_temp.state('preflight-save-input'),(pg_temp.state('limit-task')->>'id')::uuid),null::jsonb,
  'SQL NULL save preflight misses before even casting expectedRevision');
select is(pg_temp.commerce_preflight('create',pg_temp.state('create-input')),pg_temp.state('created'),'create preflight replays original stored result');
select is(pg_temp.commerce_preflight('save',pg_temp.state('save-input'),(pg_temp.state('created')->>'id')::uuid),pg_temp.state('saved'),
  'save preflight replays after revision advanced and task archived');
select throws_ok($$select public.commerce_dispatch(pg_temp.cid('owner'),'create',null,pg_temp.state('create-input'),'changed-preflight-hash',null,gen_random_uuid())$$,
  '23505','idempotency_conflict','preflight still rejects same key with a different hash');
select throws_ok($$select pg_temp.commerce_preflight('save',pg_temp.state('preflight-save-input'),(pg_temp.state('limit-task')->>'id')::uuid,pg_temp.cid('other'))$$,
  '42501','task_not_found','preflight still checks owner before returning a miss');
select is(pg_temp.commerce_footprint(),pg_temp.state('before-preflight'),'preflight hit/miss/conflict causes no reconciliation, budget or persistence writes');
select throws_ok($$select public.commerce_dispatch(pg_temp.cid('owner'),'create',null,
  pg_temp.state('create-input')||jsonb_build_object('requestId',gen_random_uuid()),'json-null-is-not-preflight','null'::jsonb,gen_random_uuid())$$,
  '22023','invalid_commerce_plan','JSON null compiled is invalid executable input, not SQL NULL preflight');

-- Fill the shared write budget, then check all six planning mutation paths.
insert into private.preview_usage_ledger(user_id,operation,metric,amount,state,business_key,correlation_id)
  select pg_temp.cid('owner'),'session_update','write',60-coalesce(sum(amount),0),'committed','commerce-test-full-budget',gen_random_uuid()
  from private.preview_usage_ledger where user_id=pg_temp.cid('owner') and metric='write' and state<>'released';
select pg_temp.keep('budget-before',pg_temp.commerce_footprint());
select throws_ok($$select pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.commerce_plan(1)))$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh create');
select throws_ok($$select pg_temp.commerce_call('save',jsonb_build_object('expectedRevision',1,'plan',pg_temp.commerce_plan(8)),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh save');
select throws_ok($$select pg_temp.commerce_call('select',jsonb_build_object('revision',1,'slotId',pg_temp.cid('slot-1'),
  'generationId',pg_temp.state('candidate-two-id'),'expectedSelectionVersion',0),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh select');
select throws_ok($$select pg_temp.commerce_call('export',jsonb_build_object('revision',1,'selections',jsonb_build_array(
  jsonb_build_object('slotId',pg_temp.cid('slot-1'),'generationId',pg_temp.state('candidate-two-id')))),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh export');
select throws_ok($$select pg_temp.commerce_call('archive',jsonb_build_object('revision',1),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh archive');
select throws_ok($$select pg_temp.commerce_call('cancel',jsonb_build_object('revision',1,'runId',pg_temp.state('later-context')#>'{runs,4,id}'),(pg_temp.state('limit-task')->>'id')::uuid)$$,
  'P0001','preview_quota_exceeded:write_hour','exhausted write budget blocks fresh cancel');
select is(pg_temp.commerce_preflight('create',pg_temp.state('preflight-create-input')),null::jsonb,'preflight miss remains read-only with exhausted budget');
select is(pg_temp.commerce_call('create',pg_temp.state('create-input')),pg_temp.state('created'),'committed create replays even with exhausted budget');
select is(pg_temp.commerce_call('save',pg_temp.state('save-input')),pg_temp.state('saved'),'committed save replays even with exhausted budget');
select is(pg_temp.commerce_call('export',pg_temp.state('export-input')),pg_temp.state('exported'),'committed export replays even with exhausted budget');
select is(pg_temp.commerce_footprint(),pg_temp.state('budget-before'),'rejected planning writes and authorized replays leave all production state/budgets unchanged');
delete from private.preview_usage_ledger where user_id=pg_temp.cid('owner') and business_key='commerce-test-full-budget';

select * from finish();
rollback;
