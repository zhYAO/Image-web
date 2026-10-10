-- Real migrated PostgreSQL/pgmq only. No provider, Storage, or HTTP calls.
-- Fixtures and queued messages are discarded by the final rollback.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider='gemini';
delete from private.provider_health_windows where provider='gemini';
select set_config('request.jwt.claims','{}',true);

create temporary table f1_state(label text primary key, value jsonb);
create function pg_temp.f1_keep(label text, value jsonb) returns void language sql as $$
  insert into f1_state values(label,value) on conflict(label) do update set value=excluded.value;
$$;
create function pg_temp.f1_saved(label text) returns jsonb language sql as $$
  select value from f1_state where f1_state.label=$1;
$$;
create function pg_temp.f1_fixture(n integer, shape text) returns jsonb language plpgsql as $$
declare
  u uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
  styles uuid[]:='{}'; slots jsonb:='[]'; compiled jsonb:='[]';
  i integer; s jsonb; cfg jsonb; refs jsonb; output_spec text; plan jsonb; body jsonb; task jsonb;
  modules text[]:=array['品牌首屏','核心卖点','产品展示','使用场景','材质细节','功能介绍',
    '规格参数','尺寸说明','结构拆解','使用步骤','适用人群','对比展示','包装内容','品牌故事','常见问题','购买提示'];
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values(u,u::text||'@f1.example.invalid',now(),false);
  insert into public.account_profiles(user_id) values(u) on conflict(user_id) do nothing;
  insert into public.sessions(id,user_id,title) values(sid,u,'Single commerce task limit fixture');
  insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
    values(product,u,sid,u::text||'/'||sid::text||'/product.webp','product.webp','image/webp',10,1,1);
  if shape='clone' then
    for i in 1..n loop
      styles:=array_append(styles,gen_random_uuid());
      insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
        values(styles[i],u,sid,u::text||'/'||sid::text||'/style-'||i||'.webp','style.webp','image/webp',10,1,1);
    end loop;
  end if;
  for i in 1..n loop
    refs:=jsonb_build_array(product);
    if shape='clone' then refs:=refs||jsonb_build_array(styles[i]); end if;
    s:=jsonb_build_object('id',gen_random_uuid(),'role','F1 item '||i,'instruction','',
      'exactText','','referenceIds',refs,'provider','gemini','model','gemini-3-pro-image',
      'aspectRatio','1:1','resolution','2K');
    if shape='detail' then
      output_spec:=case when i<=n/2 then 'desktop' else 'mobile' end;
      s:=s||jsonb_build_object('module',modules[((i-1) % (n/2))+1],'outputSpec',output_spec,
        'aspectRatio',case when output_spec='desktop' then '16:9' else '4:3' end,
        'targetWidth',case when output_spec='desktop' then 1464 else 600 end,
        'targetHeight',case when output_spec='desktop' then 600 else 450 end);
    end if;
    cfg:=jsonb_build_object('aspectRatio',s->>'aspectRatio','resolution','2K','count',1,
      'referenceIds',refs,'registryVersion','2026-10-06.1');
    if shape='detail' then cfg:=cfg||jsonb_build_object('targetWidth',s->'targetWidth','targetHeight',s->'targetHeight'); end if;
    slots:=slots||jsonb_build_array(s);
    compiled:=compiled||jsonb_build_array(jsonb_build_object('slotId',s->>'id','prompt','F1 compiled item '||i,
      'hash',md5(s::text),'provider',s->>'provider','model',s->>'model',
      'templateVersion','1.0.0','compilerVersion','commerce-3','config',cfg));
  end loop;
  plan:=jsonb_build_object('scene',shape,'templateId',case when shape='detail' then 'detail-module' else 'white-main' end,
    'brief',jsonb_build_object('name','F1 fixture','facts','','sellingPoints','','platform','taobao',
      'placement','main','productReferenceIds',jsonb_build_array(product),'styleReferenceIds',to_jsonb(styles)),'slots',slots);
  body:=jsonb_build_object('requestId',gen_random_uuid(),'sessionId',sid,'plan',plan);
  task:=public.commerce_dispatch(u,'create',null,body,md5(body::text),compiled,gen_random_uuid());
  perform public.credit_dispatch(u,'wallet','{}');
  perform public.credit_admin(jsonb_build_object('action','grant','userId',u,'amountMinor',100000,
    'reason','Disposable F1 fixture balance','actor','database test','requestId',gen_random_uuid(),'apply',true));
  return jsonb_build_object('userId',u,'sessionId',sid,'taskId',task->>'id','slots',slots,
    'slotIds',(select jsonb_agg(slot_value->'id' order by ord) from jsonb_array_elements(slots) with ordinality e(slot_value,ord)));
end $$;

create function pg_temp.f1_submit(f jsonb, enabled boolean, req uuid, billing_total integer default null)
returns jsonb language plpgsql as $$
declare body jsonb; version text;
begin
  body:=jsonb_build_object('requestId',req,'revision',1,'slotIds',f->'slotIds','recreate',false,'source','direct');
  if enabled then
    select s.version into version from private.credit_settings s where singleton;
    return public.credit_dispatch((f->>'userId')::uuid,'commerce',body||jsonb_build_object(
      'taskId',f->>'taskId','requestHash',md5(body::text),'correlationId',gen_random_uuid(),
      'billing',jsonb_build_object('version',version,'totalMinor',coalesce(billing_total,80*jsonb_array_length(f->'slotIds')))));
  end if;
  return public.commerce_dispatch((f->>'userId')::uuid,'submit',(f->>'taskId')::uuid,body,md5(body::text),null,gen_random_uuid());
end $$;

create function pg_temp.f1_quote(f jsonb, extra_input jsonb default '{}') returns jsonb language plpgsql as $$
begin
  return public.credit_dispatch((f->>'userId')::uuid,'quote',jsonb_build_object('action','commerce','input',
    jsonb_build_object('taskId',f->>'taskId','revision',1,'slotIds',f->'slotIds')||extra_input));
exception when others then return jsonb_build_object('message',sqlerrm);
end $$;

create function pg_temp.f1_snapshot(f jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'runs',(select count(*) from public.commerce_runs where task_id=(f->>'taskId')::uuid),
    'items',(select count(*) from public.commerce_run_items where task_id=(f->>'taskId')::uuid),
    'generations',(select count(*) from public.generations g join public.generation_batches b on b.id=g.batch_id where b.user_id=(f->>'userId')::uuid),
    'batches',(select count(*) from public.generation_batches where user_id=(f->>'userId')::uuid),
    'queue',(select count(*) from pgmq.q_image_generation),
    'quota',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from private.quota_ledger q where q.user_id=(f->>'userId')::uuid),
    'preview',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from private.preview_usage_ledger p where p.user_id=(f->>'userId')::uuid),
    'wallet',(select to_jsonb(w) from private.credit_wallets w where w.user_id=(f->>'userId')::uuid),
    'operations',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') from private.credit_operations o where o.user_id=(f->>'userId')::uuid),
    'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by r.request_id),'[]') from private.credit_requests r where r.user_id=(f->>'userId')::uuid),
    'ledger',(select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from private.credit_ledger l where l.user_id=(f->>'userId')::uuid));
$$;

-- Catch only to inspect the real subtransaction result and rollback conservation.
create function pg_temp.f1_attempt(f jsonb, enabled boolean, req uuid, billing_total integer default null)
returns jsonb language plpgsql as $$
declare result jsonb; code text; message text; constraint_name text;
begin
  result:=pg_temp.f1_submit(f,enabled,req,billing_total);
  return jsonb_build_object('result',result);
exception when others then
  get stacked diagnostics code=returned_sqlstate,message=message_text,constraint_name=constraint_name;
  return jsonb_build_object('sqlstate',code,'message',message,'constraint',constraint_name);
end $$;

create function pg_temp.f1_case(n integer, enabled boolean, shape text) returns setof text language plpgsql as $$
declare
  f jsonb; u uuid; t uuid; req uuid:=gen_random_uuid(); outcome jsonb; replay jsonb;
  before_state jsonb; after_state jsonb; quote jsonb; label text;
begin
  label:=shape||'-'||n||'-credits-'||enabled;
  update private.credit_settings set enabled=f1_case.enabled where singleton;
  f:=pg_temp.f1_fixture(n,shape); u:=(f->>'userId')::uuid; t:=(f->>'taskId')::uuid;
  before_state:=pg_temp.f1_snapshot(f);
  if enabled then
    quote:=pg_temp.f1_quote(f);
    return next is((quote->>'totalMinor')::integer,80*n,label||' trusted saved-task quote totals all selected children');
    return next is(jsonb_array_length(quote->'items'),n,label||' quote preserves each child');
  end if;
  outcome:=pg_temp.f1_attempt(f,enabled,req);
  after_state:=pg_temp.f1_snapshot(f);
  if not enabled and n=32 then
    return next is(outcome->>'message','quota_exceeded',label||' retains existing 30/day guard');
    return next is(after_state,before_state,label||' child 31 failure rolls back every child and queue/wallet/ledger mutation');
    return;
  end if;
  return next ok(outcome ? 'result',label||' full selection accepted: '||coalesce(outcome->>'message','success'));
  return next is((after_state->>'runs')::integer,1,label||' has one execution group');
  return next is((after_state->>'items')::integer,n,label||' persists all ordered items');
  return next is((after_state->>'generations')::integer,n,label||' creates one generation per child');
  return next is((after_state->>'batches')::integer,n,label||' keeps per-child model batch count one');
  return next is((after_state->>'queue')::integer-(before_state->>'queue')::integer,n,label||' queues exactly each child');
  return next is((select max(position) from public.commerce_run_items where task_id=t),n,label||' persists final position');
  return next ok(not exists(select 1 from public.generations g join public.generation_batches b on b.id=g.batch_id
    where b.user_id=u and (b.config->>'count')::integer<>1),label||' never widens per-child count');
  return next is((after_state#>>'{wallet,frozen_minor}')::integer,case when enabled then 80*n else 0 end,label||' freezes exact price only when billing enabled');
  return next is(jsonb_array_length(after_state->'operations'),case when enabled then n else 0 end,label||' each billed child reserved once');
  replay:=pg_temp.f1_attempt(f,enabled,req);
  return next is(replay,outcome,label||' same request returns same result');
  return next is(pg_temp.f1_snapshot(f),after_state,label||' replay adds no run/queue/quota/charge');
  if n=32 then perform pg_temp.f1_keep('full32',f); end if;
end $$;

select pg_temp.f1_case(n,enabled,shape)
from (values(8,'product-set'),(9,'product-set'),(12,'detail'),(20,'product-set'),(20,'clone'),(32,'detail')) c(n,shape)
cross join (values(false),(true)) e(enabled);

update private.credit_settings set enabled=true;
select pg_temp.f1_keep('raw-owner',pg_temp.f1_fixture(1,'product-set'));
create function pg_temp.f1_image_items(n integer, quantity integer default 1) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('operation','image','provider','gemini','model','gemini-3-pro-image','resolution','2K','count',quantity)) from generate_series(1,n);
$$;
select throws_ok($$select private.credit_quote(pg_temp.f1_image_items(9))$$,'P0001','invalid_credit_items','legacy quote still rejects 9 raw items');
select throws_ok($$select public.credit_dispatch((pg_temp.f1_saved('raw-owner')->>'userId')::uuid,'quote',jsonb_build_object('items',pg_temp.f1_image_items(9)))$$,'P0001','invalid_credit_items','public raw quote cannot opt into commerce capacity');
select is((private.credit_quote(pg_temp.f1_image_items(8,8))->>'totalMinor')::integer,5120,'legacy 8 rows/count 8 quote retains its original price');
select throws_ok($$select private.credit_quote(pg_temp.f1_image_items(1,9))$$,'P0001','invalid_credit_count','legacy per-item count remains at 8');

-- Keep direct-image admission at 1..4 even if a generic price quote accepts count 8.
select throws_ok($$select public.credit_dispatch((pg_temp.f1_saved('raw-owner')->>'userId')::uuid,'image',jsonb_build_object(
  'requestId',gen_random_uuid(),'sessionId',pg_temp.f1_saved('raw-owner')->>'sessionId','prompt','F1 direct guard',
  'provider','gemini','model','gemini-3-pro-image','config',jsonb_build_object('count',5,'aspectRatio','1:1','resolution','2K','referenceIds','[]'::jsonb),
  'billing',jsonb_build_object('version',(select version from private.credit_settings where singleton),'totalMinor',400),
  'requestHash','direct-five','correlationId',gen_random_uuid()))$$,'22023',null,'direct generation still rejects count 5');

select pg_temp.f1_keep('insufficient',pg_temp.f1_fixture(20,'product-set'));
update private.credit_wallets set available_minor=80*19 where user_id=(pg_temp.f1_saved('insufficient')->>'userId')::uuid;
select pg_temp.f1_keep('insufficient-before',pg_temp.f1_snapshot(pg_temp.f1_saved('insufficient')));
select is(pg_temp.f1_attempt(pg_temp.f1_saved('insufficient'),true,gen_random_uuid())->>'message','insufficient_credits','child 20 insufficient balance rejects the full execution group');
select is(pg_temp.f1_snapshot(pg_temp.f1_saved('insufficient')),pg_temp.f1_saved('insufficient-before'),'late balance rejection rolls back runs/items/generations/queue/quota/wallet/requests/ledger');

select pg_temp.f1_keep('stale',pg_temp.f1_fixture(20,'clone'));
select pg_temp.f1_keep('stale-before',pg_temp.f1_snapshot(pg_temp.f1_saved('stale')));
select is(pg_temp.f1_attempt(pg_temp.f1_saved('stale'),true,gen_random_uuid(),80*20-1)->>'message','credit_price_changed','commerce large quote still requires exact confirmed price');
select is(pg_temp.f1_snapshot(pg_temp.f1_saved('stale')),pg_temp.f1_saved('stale-before'),'stale price leaves all generation and billing state unchanged');
select throws_ok($$select public.credit_dispatch((pg_temp.f1_saved('raw-owner')->>'userId')::uuid,'quote',jsonb_build_object(
  'action','commerce','input',jsonb_build_object('taskId',pg_temp.f1_saved('stale')->>'taskId','revision',1,'slotIds',pg_temp.f1_saved('stale')->'slotIds')))$$,'P0001','revision_conflict','commerce quote remains tied to owner and saved revision');
select is((pg_temp.f1_quote(pg_temp.f1_saved('stale'),jsonb_build_object('items',pg_temp.f1_image_items(1),'count',1))->>'totalMinor')::integer,
  1600,'commerce quote ignores client prices/counts and reconstructs every saved selected child');

-- Check actual table enforcement, using persisted real 32-child results.
select throws_ok($$update public.commerce_run_items set position=0 where task_id=(pg_temp.f1_saved('full32')->>'taskId')::uuid and position=32$$,'23514',null,'position zero remains forbidden');
select throws_ok($$update public.commerce_run_items set position=33 where task_id=(pg_temp.f1_saved('full32')->>'taskId')::uuid and position=32$$,'23514',null,'position 33 remains forbidden');
select throws_ok($$select private.credit_quote(pg_temp.f1_image_items(33),true)$$,'P0001','invalid_credit_items','commerce internal quote rejects 33 rows');
select throws_ok($$select private.credit_quote(pg_temp.f1_image_items(1,2),true)$$,'P0001','invalid_credit_count','commerce internal quote cannot inflate per-child count');
select throws_ok($$select private.credit_quote('[{"operation":"chat","provider":"doubao","model":"doubao","resolution":"","count":1}]'::jsonb,true)$$,'P0001','invalid_credit_items','expanded quote cannot price ordinary text items as commerce');
select has_function('private','credit_quote',array['jsonb','boolean'],'internal commerce quote overload exists');
select ok(not coalesce(has_function_privilege('anon',to_regprocedure('private.credit_quote(jsonb,boolean)'),'execute'),false),'anonymous cannot invoke expanded quote');
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure('private.credit_quote(jsonb,boolean)'),'execute'),false),'clients cannot invoke expanded quote');
select ok(not coalesce(has_function_privilege('service_role',to_regprocedure('private.credit_quote(jsonb,boolean)'),'execute'),false),'service role cannot bypass trusted quote reconstruction');
select ok(has_function_privilege('service_role','public.credit_dispatch(uuid,text,jsonb)','execute'),'trusted dispatcher keeps existing service role access');

select * from finish();
rollback;
