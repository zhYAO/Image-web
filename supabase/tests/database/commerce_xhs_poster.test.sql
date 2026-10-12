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

create function pg_temp.poster_plan(mode text default 'content') returns jsonb language sql as $$
  select jsonb_set(jsonb_set(jsonb_set(pg_temp.commerce_plan(1),'{scene}','"xhs-poster"'),'{brief}',
    (pg_temp.commerce_plan(1)->'brief') || jsonb_build_object('platform','xiaohongshu','contentMode',mode,
    'facts','Five useful tips','productReferenceIds',case when mode='content' then '[]'::jsonb else jsonb_build_array(pg_temp.cid('reference')) end)),
    '{slots,0,referenceIds}',case when mode='content' then '[]'::jsonb else jsonb_build_array(pg_temp.cid('reference')) end);
$$;
create function pg_temp.validate(plan jsonb) returns void language sql as $$
  select private.commerce_validate_plan(plan,pg_temp.commerce_compile(plan));
$$;
select lives_ok($$select pg_temp.validate(pg_temp.commerce_plan(1))$$,'legacy plan without mode remains valid');
select lives_ok($$select pg_temp.validate(pg_temp.poster_plan('product'))$$,'product poster accepts product references');
select lives_ok($$select pg_temp.validate(pg_temp.poster_plan())$$,'content poster accepts no references');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{scene}','"social"'))$$,
  '22023','invalid_commerce_brief','content mode cannot bypass old-scene product rules');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,contentMode}','null'))$$,
  '22023','invalid_commerce_brief','explicit null content mode fails closed');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,contentMode}','"unknown"'))$$,
  '22023','invalid_commerce_brief','unknown content mode fails closed');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,platform}','"taobao"'))$$,
  '22023','invalid_commerce_brief','poster requires Xiaohongshu');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,name}','"  "'))$$,
  '22023','commerce_brief_incomplete','content requires nonempty title');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,facts}','"  "'))$$,
  '22023','commerce_brief_incomplete','content requires nonempty body');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,facts}',to_jsonb(E'\n\t'::text)))$$,
  '22023','commerce_brief_incomplete','content body rejects whitespace-only lines');
select throws_ok($$select pg_temp.validate(jsonb_set(pg_temp.poster_plan(),'{brief,productReferenceIds}',jsonb_build_array(pg_temp.cid('reference'))))$$,
  '22023','commerce_brief_incomplete','content cannot carry product references');

select pg_temp.keep('create-input',jsonb_build_object('requestId',pg_temp.cid('poster-create'),'sessionId',pg_temp.cid('session'),'plan',pg_temp.poster_plan()));
select pg_temp.keep('created',pg_temp.commerce_call('create',pg_temp.state('create-input')));
select is(pg_temp.commerce_call('create',pg_temp.state('create-input')),pg_temp.state('created'),'poster create replays idempotently');
select pg_temp.keep('submit-input',jsonb_build_object('requestId',pg_temp.cid('poster-submit'),'revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))));
select pg_temp.keep('submitted',pg_temp.commerce_call('submit',pg_temp.state('submit-input')));
select is(jsonb_array_length(pg_temp.state('submitted')->'runs'),1,'zero-reference poster enqueues one run');
select is((select count(*) from public.generations),1::bigint,'zero-reference poster creates one generation');
select is((select params->'referenceIds' from public.generations limit 1),'[]'::jsonb,'worker receives empty reference array');
select is((select prompt from public.generations limit 1),'Compiled Product 1','submit uses frozen compiled prompt');
select is(pg_temp.commerce_call('submit',pg_temp.state('submit-input')),pg_temp.state('submitted'),'poster submit replays idempotently');
select is((select count(*) from private.quota_ledger where entry_type='reserve'),1::bigint,'replay does not double-reserve image quota');
select throws_ok($$select pg_temp.commerce_call('submit',pg_temp.state('submit-input'),(pg_temp.state('created')->>'id')::uuid,pg_temp.cid('other'))$$,
  '42501','task_not_found','reference-free poster retains owner checks');
select throws_ok($$select pg_temp.commerce_call('save',jsonb_build_object('expectedRevision',1,'plan',jsonb_set(pg_temp.poster_plan(),'{scene}','"detail"')))$$,
  '22023','invalid_commerce_brief','save cannot move content mode into product scene');
select pg_temp.keep('saved',pg_temp.commerce_call('save',jsonb_build_object('expectedRevision',1,'plan',jsonb_set(pg_temp.poster_plan(),'{brief,facts}','"Revised tips"'))));
select is((pg_temp.state('saved')->>'revision')::integer,2,'valid content edit persists next revision');

-- Style-only references are optional, but their ownership/expiry and per-slot
-- membership remain subject to exactly the same submit admission checks.
select pg_temp.keep('style-plan',jsonb_set(jsonb_set(pg_temp.poster_plan(),'{brief,styleReferenceIds}',jsonb_build_array(pg_temp.cid('reference'))),'{slots,0,referenceIds}',jsonb_build_array(pg_temp.cid('reference'))));
select pg_temp.keep('style-task',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',pg_temp.state('style-plan'))));
update public.reference_uploads set upload_expires_at=now()-interval '1 second' where id=pg_temp.cid('reference');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('style-task')->>'id')::uuid)$$,
  '22023','reference_expired_or_forbidden','content style reference expiry remains enforced');
update public.reference_uploads set upload_expires_at=now()+interval '1 day' where id=pg_temp.cid('reference');
update public.reference_uploads set user_id=pg_temp.cid('other'),session_id=pg_temp.cid('other-session') where id=pg_temp.cid('reference');
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('style-task')->>'id')::uuid)$$,
  '22023','reference_expired_or_forbidden','content style reference cannot cross owner boundaries');
update public.reference_uploads set user_id=pg_temp.cid('owner'),session_id=pg_temp.cid('session') where id=pg_temp.cid('reference');
select lives_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('style-task')->>'id')::uuid)$$,
  'style-only content poster submits with active owned reference');
select pg_temp.keep('bad-slot-task',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',jsonb_set(pg_temp.poster_plan(),'{slots,0,referenceIds}',jsonb_build_array(pg_temp.cid('reference'))))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('bad-slot-task')->>'id')::uuid)$$,
  '22023','invalid_references','content slot cannot introduce undeclared references');
select pg_temp.keep('legacy-empty',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',jsonb_set(pg_temp.commerce_plan(1),'{brief,productReferenceIds}','[]'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('legacy-empty')->>'id')::uuid)$$,
  '22023','commerce_brief_incomplete','legacy product submission still requires product reference');
select pg_temp.keep('product-no-overlap',pg_temp.commerce_call('create',jsonb_build_object('sessionId',pg_temp.cid('session'),'plan',jsonb_set(pg_temp.poster_plan('product'),'{slots,0,referenceIds}','[]'))));
select throws_ok($$select pg_temp.commerce_call('submit',jsonb_build_object('revision',1,'slotIds',jsonb_build_array(pg_temp.cid('slot-1'))),(pg_temp.state('product-no-overlap')->>'id')::uuid)$$,
  '22023','invalid_references','product poster slot still requires product reference overlap');
select ok(not has_function_privilege('authenticated','private.commerce_validate_plan(jsonb,jsonb)','execute'),'validator privileges remain private');
select ok(not has_function_privilege('authenticated','public.commerce_dispatch(uuid,text,uuid,jsonb,text,jsonb,uuid)','execute'),'dispatcher remains service role only');
select * from finish();
rollback;
