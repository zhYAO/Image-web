-- Local candidate only. Configuration starts empty/disabled; no supplier prices are assumed.
create table private.commerce_package_cost_versions (
 version text primary key, costs jsonb not null, created_at timestamptz not null default now());
create table private.commerce_package_sale_versions (
 version text primary key, sale jsonb not null, created_at timestamptz not null default now());
create table private.commerce_package_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 cost_version text references private.commerce_package_cost_versions, sale_version text references private.commerce_package_sale_versions);
insert into private.commerce_package_settings(singleton) values(true);
create table private.commerce_package_quotes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 session_id uuid not null, request_id uuid not null, request_hash text not null,
 snapshot jsonb not null, reference_binding jsonb not null, expires_at timestamptz not null,
 created_at timestamptz not null default now(), unique(user_id,request_id));
create table private.commerce_package_orders (
 id uuid primary key, user_id uuid not null references auth.users on delete cascade,session_id uuid not null,
 quote_id uuid not null unique references private.commerce_package_quotes, request_id uuid not null,
 operation_id uuid not null unique references private.credit_operations,
 state jsonb not null, revision bigint not null default 1, settled boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,request_id));
create table private.commerce_package_events (
 id bigint generated always as identity primary key,order_id uuid not null references private.commerce_package_orders on delete cascade,
 revision bigint not null,kind text not null,data jsonb not null,created_at timestamptz not null default now(),unique(order_id,revision));
create table private.commerce_package_generations (
 order_id uuid not null references private.commerce_package_orders on delete cascade,
 stage_key text not null,generation_id uuid not null unique,primary key(order_id,stage_key));

create function private.commerce_package_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'package_version_is_immutable';end $$;
create trigger package_cost_immutable before update or delete on private.commerce_package_cost_versions for each row execute function private.commerce_package_immutable();
create trigger package_sale_immutable before update or delete on private.commerce_package_sale_versions for each row execute function private.commerce_package_immutable();
create trigger package_quote_immutable before update on private.commerce_package_quotes for each row execute function private.commerce_package_immutable();
alter table private.credit_operations drop constraint credit_operations_operation_check;
alter table private.credit_operations add constraint credit_operations_operation_check check(operation in ('image','chat','optimize','commerce_package'));

create function private.commerce_package_config() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('costVersion',c.version,'costs',c.costs,'saleVersion',v.version,'sale',v.sale)
 from private.commerce_package_settings s join private.commerce_package_cost_versions c on c.version=s.cost_version
 join private.commerce_package_sale_versions v on v.version=s.sale_version where s.singleton and s.enabled and v.sale->>'settlement'='fixed_images' and jsonb_typeof(v.sale->'imagePrices')='array' and length(coalesce(v.sale->>'priceEvidence',''))between 10 and 2000 and v.sale->>'sharedCostPolicy'='include_once_if_any_success' and v.sale->>'minimumPolicy'='whole_order';
$$;

-- Database is authoritative: clients cannot submit a price, markup or successful count.
create function private.commerce_package_price(cfg jsonb,sel jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;r integer;costs jsonb:=cfg->'costs';sale jsonb:=cfg->'sale';a numeric;p numeric;i numeric;c numeric;total bigint;stages jsonb;idx integer;key text;spec text;unit_minor bigint;price jsonb;fixed_total numeric:=0;
begin
 if (costs->>'visionMaxInputTokens')::integer>32000 or(costs->>'plannerMaxInputTokens')::integer>32000 then raise exception 'price_tier_unverified';end if;
 if cfg is null or sale->>'settlement' not in ('fixed','actual_capped','fixed_images') or sale->>'refund' is distinct from 'successful_images' then raise exception 'package_configuration_missing';end if;
 if jsonb_typeof(sel->'modules') is distinct from 'array' or jsonb_array_length(sel->'modules') not between 1 and 16
  or jsonb_typeof(sel->'advanced') is distinct from 'boolean' or (select count(distinct x) from jsonb_array_elements_text(sel->'modules')x)<>jsonb_array_length(sel->'modules')
  or exists(select 1 from jsonb_array_elements_text(sel->'modules')x where x not in ('品牌首屏','核心卖点','产品展示','使用场景','材质细节','功能介绍','规格参数','尺寸说明','结构拆解','使用步骤','适用人群','对比展示','包装内容','品牌故事','常见问题','购买提示')) then raise exception 'invalid_package_selection';end if;
 r:=(sel->>'referenceCount')::integer;if r is null or r not between 1 and 10 then raise exception 'invalid_references';end if;
 n:=jsonb_array_length(sel->'modules')*case when (sel->>'advanced')::boolean then 2 else 1 end;
 foreach key in array array['imageOutputNano','extraReferenceNano','visionInputPerMillionNano','visionOutputPerMillionNano','plannerInputPerMillionNano','plannerOutputPerMillionNano'] loop
  if coalesce(costs->>key,'') !~ '^(0|[1-9][0-9]{0,18})$' then raise exception 'invalid_package_cost';end if;
 end loop;
 foreach key in array array['visionMaxInputTokens','visionMaxOutputTokens','plannerMaxInputTokens','plannerMaxOutputTokens'] loop
  if coalesce(costs->>key,'') !~ '^[1-9][0-9]{0,5}$' or (costs->>key)::integer>256000 then raise exception 'invalid_package_cost';end if;
 end loop;
 if coalesce(sale->>'markupBps','') !~ '^[0-9]{1,7}$' or (sale->>'markupBps')::integer>1000000
  or coalesce(sale->>'minimumMinor','') !~ '^[0-9]{1,9}$' or (sale->>'minimumMinor')::integer not between 50 and 100000000
  or coalesce(sale->>'quoteSeconds','') !~ '^[0-9]{1,4}$' or (sale->>'quoteSeconds')::integer not between 60 and 3600 then raise exception 'invalid_package_sale';end if;
 a:=ceil(((costs->>'visionMaxInputTokens')::numeric*(costs->>'visionInputPerMillionNano')::numeric+(costs->>'visionMaxOutputTokens')::numeric*(costs->>'visionOutputPerMillionNano')::numeric)/1000000);
 p:=ceil(((costs->>'plannerMaxInputTokens')::numeric*(costs->>'plannerInputPerMillionNano')::numeric+(costs->>'plannerMaxOutputTokens')::numeric*(costs->>'plannerOutputPerMillionNano')::numeric)/1000000);
 i:=greatest((costs->>'imageOutputNano')::numeric,coalesce((costs->>'imageOutputLowNano')::numeric,0))+(r-1)*(costs->>'extraReferenceNano')::numeric;c:=a+p+n*i;
 if ceil(c*(10000+(sale->>'markupBps')::numeric)/100000000000)>9007199254740991 then raise exception 'package_amount_out_of_range';end if;
 total:=greatest((sale->>'minimumMinor')::bigint,ceil(c*(10000+(sale->>'markupBps')::numeric)/100000000000)::bigint);
 if sale->>'settlement'='fixed_images'then
  if costs->>'imageResolution'is distinct from '2K'or costs->>'imageModel'is distinct from 'doubao-seedream-5.0-pro'or sale->>'minimumPolicy'is distinct from 'whole_order'or length(coalesce(sale->>'priceEvidence',''))not between 10 and 2000 or jsonb_typeof(sale->'imagePrices')is distinct from 'array'or jsonb_array_length(sale->'imagePrices')not between 1 and 96 then raise exception 'package_image_price_unpublished';end if;
  if exists(select 1 from jsonb_array_elements(sale->'imagePrices')price_row where coalesce(price_row->>'estimatedUnitCostNano','')!~'^[1-9][0-9]{0,18}$'or price_row->>'spec'not in('standard','desktop','mobile')or price_row->>'resolution'not in('1K','2K','4K')or coalesce(length(price_row->>'model'),0)not between 1 and 100)
   or(select count(*)from jsonb_array_elements(sale->'imagePrices'))<>(select count(distinct(price_row->>'model',price_row->>'resolution',price_row->>'spec'))from jsonb_array_elements(sale->'imagePrices')price_row)then raise exception 'invalid_package_image_price';end if;
 end if;
 stages:=jsonb_build_array(jsonb_build_object('key','analysis','kind','analysis','costNano',a::text,'amountMinor',0),jsonb_build_object('key','planning','kind','planning','costNano',p::text,'amountMinor',0));
 for idx in 0..n-1 loop
  if sale->>'settlement'='fixed_images'then
   spec:=case when not(sel->>'advanced')::boolean then 'standard'when idx<jsonb_array_length(sel->'modules')then 'desktop'else 'mobile'end;
   select price_row into price from jsonb_array_elements(sale->'imagePrices')price_row where price_row->>'model'=costs->>'imageModel'and price_row->>'resolution'=costs->>'imageResolution'and price_row->>'spec'=spec;
   if price is null then raise exception 'package_image_price_unpublished';end if;
   unit_minor:=ceil((price->>'estimatedUnitCostNano')::numeric*(10000+(sale->>'markupBps')::numeric)/100000000000)::bigint;
   fixed_total:=fixed_total+unit_minor;
  else unit_minor:=total/n+case when idx<total%n then 1 else 0 end;end if;
  stages:=stages||jsonb_build_array(jsonb_build_object('key','image:'||idx,'kind','image','costNano',i::text,'amountMinor',unit_minor));
 end loop;
 if sale->>'settlement'='fixed_images'then
  if fixed_total>9007199254740991 then raise exception 'package_amount_out_of_range';end if;
  total:=greatest((sale->>'minimumMinor')::bigint,fixed_total::bigint);
 end if;
 return cfg||jsonb_build_object('selection',sel,'outputCount',n,'estimatedCostNano',c::text,'totalMinor',total,'stages',stages);
end $$;

create function private.commerce_package_projection(oid uuid) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('state',o.state,'revision',o.revision,'settled',o.settled,'references',q.reference_binding) from private.commerce_package_orders o join private.commerce_package_quotes q on q.id=o.quote_id where o.id=oid;
$$;
-- Frozen per-image sale prices; legacy usage-based snapshots retain their original estimate calculator.
create function private.commerce_package_actual_amount(st jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb:=st->'quote';c jsonb:=q->'costs';sale jsonb:=q->'sale';total bigint:=(q->>'totalMinor')::bigint;capture bigint;shared numeric:=0;image_cost numeric:=0;receipt jsonb;meter jsonb;item jsonb;key text;input_n integer;output_n integer;max_input integer;max_output integer;input_rate numeric;output_rate numeric;rate numeric;successes integer:=0;images integer:=0;reason text;
begin
 if exists(select 1 from jsonb_array_elements(st->'stages')j where j->>'kind'='image' and j->>'status' not in ('succeeded','failed','skipped'))then reason:='image_result_pending';
 else
  select count(*)filter(where j->>'status'='succeeded'),count(*)into successes,images from jsonb_array_elements(st->'stages')j where j->>'kind'='image';
  if successes=0 then return jsonb_build_object('captureMinor',0,'releaseMinor',total,'pendingMinor',0);end if;
  if sale->>'settlement'='fixed_images'then
   select sum((j->>'amountMinor')::bigint)into capture from jsonb_array_elements(st->'stages')j where j->>'kind'='image'and j->>'status'='succeeded';
   capture:=greatest((sale->>'minimumMinor')::bigint,capture);
   if capture>total then return jsonb_build_object('captureMinor',0,'releaseMinor',0,'pendingMinor',total,'reviewReason','invalid_package_settlement');end if;
   return jsonb_build_object('captureMinor',capture,'releaseMinor',total-capture,'pendingMinor',0);
  end if;
  if sale->>'settlement'='fixed' then
   select sum((j->>'amountMinor')::bigint)into capture from jsonb_array_elements(st->'stages')j where j->>'kind'='image' and j->>'status'='succeeded';
   return jsonb_build_object('captureMinor',capture,'releaseMinor',total-capture,'pendingMinor',0);
  end if;
  if sale->>'settlement' is distinct from 'actual_capped' or sale->>'sharedCostPolicy' is distinct from 'include_once_if_any_success' or sale->>'minimumPolicy' is distinct from 'whole_order' or coalesce(c->>'imagePixelThreshold','') !~ '^[1-9][0-9]{0,8}$' then reason:='settlement_policy_missing';end if;
  if reason is null and ((c->>'visionMaxInputTokens')::integer>32000 or (c->>'plannerMaxInputTokens')::integer>32000)then reason:='price_tier_unverified';end if;
  if reason is null then
   foreach key in array array['analysis','planning']loop
    select j->'result' into receipt from jsonb_array_elements(st->'stages')j where j->>'key'=key and j->>'status'='succeeded';
    if receipt is null or coalesce(length(receipt->>'providerRequestId'),0)not between 1 and 200 or receipt->>'model' is distinct from c->>(case when key='analysis'then 'visionModel' else 'plannerModel'end)
     or not exists(select 1 from jsonb_array_elements_text(c->(case when key='analysis'then 'visionResponseModels'else 'plannerResponseModels'end))x where x=receipt->>'resolvedModel')
     or coalesce(receipt#>>'{usage,inputTokens}','') !~ '^[0-9]{1,6}$' or coalesce(receipt#>>'{usage,outputTokens}','') !~ '^[0-9]{1,6}$' then reason:='usage_unverified';exit;end if;
    if receipt#>>'{usage,cachedInputTokens}' is distinct from '0'then reason:='cache_usage_unverified';exit;end if;
    input_n:=(receipt#>>'{usage,inputTokens}')::integer;output_n:=(receipt#>>'{usage,outputTokens}')::integer;
    max_input:=(c->>(case when key='analysis'then 'visionMaxInputTokens'else 'plannerMaxInputTokens'end))::integer;
    max_output:=(c->>(case when key='analysis'then 'visionMaxOutputTokens'else 'plannerMaxOutputTokens'end))::integer;
    if input_n>max_input or output_n>max_output then reason:='usage_budget_exceeded';exit;end if;
    input_rate:=(c->>(case when key='analysis'then 'visionInputPerMillionNano'else 'plannerInputPerMillionNano'end))::numeric;
    output_rate:=(c->>(case when key='analysis'then 'visionOutputPerMillionNano'else 'plannerOutputPerMillionNano'end))::numeric;
    shared:=shared+ceil((input_n*input_rate+output_n*output_rate)/1000000);
   end loop;
  end if;
  if reason is null then
   for item in select value from jsonb_array_elements(st->'stages')where value->>'kind'='image' and value->>'status'='succeeded'loop
    meter:=item->'metering';
    if meter->>'source' is distinct from 'provider_response' or meter->>'model' is distinct from c->>'imageModel' or meter->>'generatedImages' is distinct from '1' or coalesce(length(meter->>'providerRequestId'),0)not between 1 and 200
     or not exists(select 1 from jsonb_array_elements_text(c->'imageResponseModels')x where x=meter->>'resolvedModel')
     or coalesce(meter->>'inputReferences','') !~ '^[0-9]{1,2}$' or coalesce(meter->>'outputWidth','') !~ '^[1-9][0-9]{0,3}$' or coalesce(meter->>'outputHeight','') !~ '^[1-9][0-9]{0,3}$' then reason:='usage_unverified';exit;end if;
    if (meter->>'inputReferences')::integer>(q#>>'{selection,referenceCount}')::integer or (meter->>'outputWidth')::integer>8192 or (meter->>'outputHeight')::integer>8192 then reason:='usage_unverified';exit;end if;
    rate:=(c->>(case when (meter->>'outputWidth')::numeric*(meter->>'outputHeight')::numeric<=(c->>'imagePixelThreshold')::numeric then 'imageOutputLowNano'else 'imageOutputNano'end))::numeric;
    if rate is null then reason:='usage_price_unavailable';exit;end if;
    image_cost:=image_cost+rate+greatest(0,(meter->>'inputReferences')::integer-1)*(c->>'extraReferenceNano')::numeric;
   end loop;
  end if;
  if reason is null then
   capture:=greatest((sale->>'minimumMinor')::bigint,ceil((shared+image_cost)*(10000+(sale->>'markupBps')::numeric)/100000000000)::bigint);
   if capture>total then reason:='cost_exceeds_authorized_cap';
   else return jsonb_build_object('captureMinor',capture,'releaseMinor',total-capture,'pendingMinor',0);end if;
  end if;
 end if;
 return jsonb_build_object('captureMinor',0,'releaseMinor',0,'pendingMinor',total,'reviewReason',reason);
end $$;

create function private.commerce_package_finish(oid uuid) returns void language plpgsql security definer set search_path='' as $$
declare o private.commerce_package_orders%rowtype;capture bigint;total bigint;release bigint;actual jsonb;
begin
 select * into o from private.commerce_package_orders where id=oid for update;
 if not found or o.settled or o.state->>'status' not in ('cancelled','completed','partial','failed') then return;end if;
 if exists(select 1 from jsonb_array_elements(o.state->'stages')s where s->>'kind'='image' and s->>'status' not in ('succeeded','failed','skipped')) then raise exception 'package_result_pending';end if;
 total:=(o.state#>>'{quote,totalMinor}')::bigint;
 actual:=private.commerce_package_actual_amount(o.state);
 if (actual->>'pendingMinor')::bigint>0 then return;end if;
 capture:=(actual->>'captureMinor')::bigint;release:=(actual->>'releaseMinor')::bigint;
 if capture<0 or release<0 or capture+release<>total then raise exception 'invalid_package_settlement';end if;
 update private.credit_wallets set frozen_minor=frozen_minor-total,available_minor=available_minor+release,spent_minor=spent_minor+capture where user_id=o.user_id and frozen_minor>=total;
 if not found then raise exception 'package_wallet_invariant';end if;
 if capture>0 then insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason) values(o.user_id,o.operation_id,'capture',capture,'package:capture:'||oid,'整套A+按成功图片结算，含分析及策划');end if;
 if release>0 then insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason) values(o.user_id,o.operation_id,'release',release,'package:release:'||oid,'退回明确未完成图片对应金额');end if;
 update private.credit_operations set status=case when capture=0 then 'refunded' else 'succeeded' end,result=jsonb_build_object('orderId',oid,'captureMinor',capture,'releaseMinor',release,'packageStatus',o.state->>'status'),updated_at=now() where id=o.operation_id;
 update private.commerce_package_orders set settled=true,updated_at=now() where id=oid;
end $$;

-- A legacy single-operation settlement must never capture a package's full amount.
alter function private.credit_settle(uuid,text,text) rename to credit_settle_legacy;
create function private.credit_settle(p_id uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.credit_operations where id=p_id and operation='commerce_package') then raise exception 'use_package_settlement';end if;
 perform private.credit_settle_legacy(p_id,p_status,p_reason);
end $$;

create function private.commerce_package_refresh(oid uuid) returns void language plpgsql security definer set search_path='' as $$
declare o private.commerce_package_orders%rowtype;s jsonb;stages jsonb:='[]';g public.generations%rowtype;w private.generation_work%rowtype;outcome text;all_done boolean:=true;unknown_result boolean:=false;successes integer:=0;images integer:=0;next_state jsonb;next_status text;actual jsonb;
begin
 select * into o from private.commerce_package_orders where id=oid for update;
 if not found or o.settled then return;end if;
 for s in select value from jsonb_array_elements(o.state->'stages') loop
  if s->>'kind'='image' then
   images:=images+1;
   if s ? 'generationId' then
    select * into g from public.generations where id=(s->>'generationId')::uuid;
    select * into w from private.generation_work where generation_id=(s->>'generationId')::uuid;
    outcome:=case when g.id is null and s->>'status' in ('succeeded','failed','skipped')then s->>'status' when g.id is null then 'unknown' when g.status='succeeded' then 'succeeded'
     when g.provider_submission_state='unknown' or w.phase='unknown' or g.error_code in ('provider_result_unknown','provider_reconciliation_required','result_storage_failed','storage_error','storage_pending','result_pending_storage') then 'unknown'
     when g.status='failed' and (g.provider_submission_state='not_submitted' or w.provider_outcome='rejected') and coalesce(w.phase,'') not in ('result','uploaded') then 'failed'
     when g.status='failed' then 'unknown' else 'processing' end;
    if s->>'status' in ('succeeded','failed') and outcome is distinct from s->>'status' then raise exception 'terminal_result_conflict';end if;
    s:=s||jsonb_build_object('status',outcome);
    if outcome='succeeded' and w.result ? 'metering' then s:=s||jsonb_build_object('metering',w.result->'metering');end if;
   end if;
   if s->>'status'='succeeded' then successes:=successes+1;end if;
   if s->>'status' not in ('succeeded','failed','skipped') then all_done:=false;end if;
  end if;
  if s->>'status'='unknown' then unknown_result:=true;end if;
  stages:=stages||jsonb_build_array(s);
 end loop;
 next_status:=case when unknown_result then 'needs_review' when all_done and successes=images then 'completed' when all_done and successes>0 then 'partial' when all_done then 'failed' else 'active' end;
 next_state:=(o.state-'reviewReason')||jsonb_build_object('stages',stages,'status',next_status);
 if all_done and not unknown_result then
  actual:=private.commerce_package_actual_amount(next_state);
  if (actual->>'pendingMinor')::bigint>0 then next_status:='needs_review';next_state:=next_state||jsonb_build_object('status',next_status,'reviewReason',actual->>'reviewReason');end if;
 end if;
 if next_state is distinct from o.state then
  update private.commerce_package_orders set state=next_state,revision=revision+1,updated_at=now() where id=oid returning * into o;
  insert into private.commerce_package_events(order_id,revision,kind,data) values(oid,o.revision,'generation_refresh',jsonb_build_object('status',next_status,'stages',stages));
 end if;
 perform private.commerce_package_finish(oid);
end $$;

create function private.commerce_package_text_ready(st jsonb)returns boolean language plpgsql security definer set search_path=''as $$
declare c jsonb:=st#>'{quote,costs}';receipt jsonb;key text;input_n integer;output_n integer;
begin
 if st#>>'{quote,sale,settlement}'='fixed_images'then
  return (select count(*)=2 from jsonb_array_elements(st->'stages')j where j->>'key'in('analysis','planning')and j->>'status'='succeeded'and jsonb_typeof(j->'result')='object');
 end if;
 if (c->>'visionMaxInputTokens')::integer>32000 or(c->>'plannerMaxInputTokens')::integer>32000 then return false;end if;
 foreach key in array array['analysis','planning']loop
  select j->'result'into receipt from jsonb_array_elements(st->'stages')j where j->>'key'=key and j->>'status'='succeeded';
  if receipt is null or coalesce(length(receipt->>'providerRequestId'),0)not between 1 and 200 or receipt->>'model' is distinct from c->>(case when key='analysis'then 'visionModel'else 'plannerModel'end)
   or not exists(select 1 from jsonb_array_elements_text(c->(case when key='analysis'then 'visionResponseModels'else 'plannerResponseModels'end))x where x=receipt->>'resolvedModel')
   or coalesce(receipt#>>'{usage,inputTokens}','') !~ '^[0-9]{1,6}$' or coalesce(receipt#>>'{usage,outputTokens}','') !~ '^[0-9]{1,6}$'then return false;end if;
  if receipt#>>'{usage,cachedInputTokens}' is distinct from '0'then return false;end if;
  input_n:=(receipt#>>'{usage,inputTokens}')::integer;output_n:=(receipt#>>'{usage,outputTokens}')::integer;
  if input_n>(c->>(case when key='analysis'then 'visionMaxInputTokens'else 'plannerMaxInputTokens'end))::integer or output_n>(c->>(case when key='analysis'then 'visionMaxOutputTokens'else 'plannerMaxOutputTokens'end))::integer then return false;end if;
 end loop;return true;
end $$;
create function public.commerce_package_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare cfg jsonb;q private.commerce_package_quotes%rowtype;o private.commerce_package_orders%rowtype;req uuid;h text;oid uuid;opid uuid;v_state jsonb;s jsonb;stages jsonb;amount bigint;sid uuid;sel jsonb;refs jsonb;task public.commerce_tasks%rowtype;plan jsonb;slot jsonb;result jsonb;submit_body jsonb;idx integer:=0;module_name text;spec text;expected_refs jsonb;
begin
 perform 1 from public.account_profiles a join auth.users u on u.id=a.user_id where u.id=p_user_id and a.status='active' and u.is_anonymous=false and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) for update of a;
 if not found then raise exception 'unauthorized';end if;
 if p_action='list'then return coalesce((select jsonb_agg(jsonb_build_object('id',x.id)order by x.created_at,x.id)from(select id,created_at from private.commerce_package_orders where user_id=p_user_id and not settled order by created_at,id limit 100)x),'[]'::jsonb);end if;
 if p_action='config' then return private.commerce_package_config();end if;
 if p_action='recover_quote'then
  select * into o from private.commerce_package_orders where user_id=p_user_id and quote_id=(p_input->>'quoteId')::uuid;
  if not found then raise exception 'package_not_found';end if;return private.commerce_package_projection(o.id);
 end if;
 if p_action='quote' then
  cfg:=private.commerce_package_config();if cfg is null then raise exception 'package_configuration_missing';end if;
  req:=(p_input->>'requestId')::uuid;h:=md5(p_input::text);if req is null then raise exception 'credit_request_id_required';end if;
  select * into q from private.commerce_package_quotes where user_id=p_user_id and request_id=req;
  if found then if q.request_hash<>h then raise exception 'idempotency_conflict';end if;return to_jsonb(q);end if;
  sid:=(p_input->>'sessionId')::uuid;
  perform 1 from public.sessions where id=sid and user_id=p_user_id and status='active' for update;if not found then raise exception 'session_not_found';end if;
  refs:=p_input->'references';sel:=p_input->'selection';
  if jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs) not between 1 and 10
   or jsonb_array_length(refs)<>(sel->>'referenceCount')::integer
   or (select count(distinct r->>'id') from jsonb_array_elements(refs)r)<>jsonb_array_length(refs)
   or not exists(select 1 from jsonb_array_elements(refs)r where r->>'role'='product')
   or exists(select 1 from jsonb_array_elements(refs)r where r->>'role' not in ('product','style')) then raise exception 'invalid_references';end if;
  if exists(select 1 from jsonb_array_elements(refs)r where not exists(select 1 from public.reference_uploads u where u.id=(r->>'id')::uuid and u.user_id=p_user_id and u.session_id=sid and u.status='active' and u.write_state='ready' and u.upload_expires_at>clock_timestamp())) then raise exception 'reference_expired_or_forbidden';end if;
  v_state:=private.commerce_package_price(cfg,sel);
  insert into private.commerce_package_quotes(user_id,session_id,request_id,request_hash,snapshot,reference_binding,expires_at) values(p_user_id,sid,req,h,v_state,refs,clock_timestamp()+make_interval(secs=>(cfg#>>'{sale,quoteSeconds}')::integer)) returning * into q;
  return to_jsonb(q);
 end if;
 if p_action='accept' then
  req:=(p_input->>'requestId')::uuid;
  select * into o from private.commerce_package_orders where user_id=p_user_id and request_id=req;
  if found then if o.quote_id<>(p_input->>'quoteId')::uuid then raise exception 'idempotency_conflict';end if;return private.commerce_package_projection(o.id);end if;
  select * into q from private.commerce_package_quotes where id=(p_input->>'quoteId')::uuid and user_id=p_user_id;
  if not found then raise exception 'package_not_found';end if;
  select * into o from private.commerce_package_orders where quote_id=q.id;
  if found then return private.commerce_package_projection(o.id);end if;
  if private.commerce_package_config() is null or q.expires_at<=clock_timestamp() then raise exception 'package_quote_expired';end if;
  if p_input->>'totalMinor' is distinct from q.snapshot->>'totalMinor' then raise exception 'credit_price_changed';end if;
  perform 1 from public.sessions where id=q.session_id and user_id=p_user_id and status='active' for update;if not found then raise exception 'session_not_found';end if;
  if not coalesce((select enabled from private.credit_settings where singleton),false) then raise exception 'credits_disabled';end if;
  perform private.credit_wallet(p_user_id);amount:=(q.snapshot->>'totalMinor')::bigint;
  update private.credit_wallets set available_minor=available_minor-amount,frozen_minor=frozen_minor+amount where user_id=p_user_id and available_minor>=amount;if not found then raise exception 'insufficient_credits';end if;
  oid:=gen_random_uuid();opid:=gen_random_uuid();
  insert into private.credit_operations(id,user_id,business_key,request_hash,operation,model,version,amount_minor,session_id) values(opid,p_user_id,'package:'||oid,md5(q.snapshot::text),'commerce_package','A+整套详情图',(select version from private.credit_settings where singleton),amount,q.session_id);
  insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason) values(p_user_id,opid,'reserve',amount,'package:reserve:'||oid,'整套报价冻结，分析与策划包含其中');
  select jsonb_agg(s||'{"status":"pending"}'::jsonb order by pos) into stages from jsonb_array_elements(q.snapshot->'stages') with ordinality x(s,pos);
  v_state:=jsonb_build_object('id',oid,'userId',p_user_id,'sessionId',q.session_id,'quote',q.snapshot,'referenceSignature',md5(q.reference_binding::text),'status','active','stages',stages);
  insert into private.commerce_package_orders(id,user_id,session_id,quote_id,request_id,operation_id,state) values(oid,p_user_id,q.session_id,q.id,req,opid,v_state);
  insert into private.commerce_package_events(order_id,revision,kind,data) values(oid,1,'accepted',jsonb_build_object('quoteId',q.id,'amountMinor',amount));
  return private.commerce_package_projection(oid);
 end if;
 oid:=(p_input->>'orderId')::uuid;
 select * into o from private.commerce_package_orders where id=oid and user_id=p_user_id;
 if not found then raise exception 'package_not_found';end if;
 -- Account -> session -> order -> task/generation -> wallet lock order.
 if p_action not in ('get','cancel')then perform 1 from public.sessions where id=o.session_id and user_id=p_user_id and status='active' for update;if not found then raise exception 'session_not_found';end if;end if;
 select * into o from private.commerce_package_orders where id=oid for update;
 if p_action='get' then perform private.commerce_package_refresh(oid);return private.commerce_package_projection(oid);end if;
 if p_action='save' then
  v_state:=p_input->'state';
  if (p_input->>'expectedRevision')::bigint is distinct from o.revision then raise exception 'revision_conflict';end if;
  if o.settled then raise exception 'package_order_closed';end if;
  if (v_state-'stages'-'review'-'status') is distinct from (o.state-'stages'-'review'-'status') or jsonb_array_length(v_state->'stages')<>jsonb_array_length(o.state->'stages') then raise exception 'package_snapshot_changed';end if;
  if o.state ? 'review' and v_state->'review' is distinct from o.state->'review' then raise exception 'facts_already_confirmed';end if;
  if v_state->>'status' not in ('active','needs_review','failed') then raise exception 'invalid_package_state';end if;
  for s in select value from jsonb_array_elements(o.state->'stages') loop
   slot:=v_state->'stages'->idx;idx:=idx+1;
   if (s-'status'-'claimId'-'result'-'failure') is distinct from (slot-'status'-'claimId'-'result'-'failure')
    or (s->>'kind'='image' and slot is distinct from s and not(s->>'status'='pending' and slot->>'status'='skipped' and not exists(select 1 from private.commerce_package_generations where order_id=oid))) then raise exception 'package_stage_changed';end if;
   if s->>'status' in ('succeeded','failed','skipped') and slot is distinct from s then raise exception 'terminal_result_conflict';end if;
   if s ? 'claimId' and slot->>'claimId' is distinct from s->>'claimId' then raise exception 'stage_already_claimed';end if;
  end loop;
  update private.commerce_package_orders set state=v_state,revision=revision+1,updated_at=now() where id=oid returning * into o;
  insert into private.commerce_package_events(order_id,revision,kind,data) values(oid,o.revision,'state',jsonb_build_object('status',v_state->>'status','stages',v_state->'stages'));
  perform private.commerce_package_finish(oid);return private.commerce_package_projection(oid);
 elsif p_action='cancel' then
  if o.settled then return private.commerce_package_projection(oid);end if;
  if exists(select 1 from private.commerce_package_generations where order_id=oid) then
   perform private.commerce_package_refresh(oid);select * into o from private.commerce_package_orders where id=oid;
   if not o.settled then raise exception 'image_result_pending';end if;return private.commerce_package_projection(oid);
  end if;
  select jsonb_agg(case when s->>'status' in ('succeeded','failed') then s else s||'{"status":"skipped"}'::jsonb end order by pos) into stages from jsonb_array_elements(o.state->'stages')with ordinality x(s,pos);
  v_state:=o.state||jsonb_build_object('status','cancelled','stages',stages);
  update private.commerce_package_orders set state=v_state,revision=revision+1 where id=oid returning * into o;
  insert into private.commerce_package_events(order_id,revision,kind,data) values(oid,o.revision,'cancelled','{"beforeImageSubmission":true}');
  perform private.commerce_package_finish(oid);return private.commerce_package_projection(oid);
 elsif p_action='submit' then
  if o.state ? 'taskId' then if o.state->>'taskId' is distinct from p_input->>'taskId' or o.state->>'taskRevision' is distinct from p_input->>'revision' then raise exception 'idempotency_conflict';end if;return private.commerce_package_projection(oid);end if;
  if o.settled or o.state->>'status'<>'active' or not(o.state ? 'review') or not exists(select 1 from jsonb_array_elements(o.state->'stages')s where s->>'key'='planning' and s->>'status'='succeeded') then raise exception 'planning_required';end if;
  if not private.commerce_package_text_ready(o.state)then raise exception 'package_usage_unverified';end if;
  select * into q from private.commerce_package_quotes where id=o.quote_id;
  select * into task from public.commerce_tasks where id=(p_input->>'taskId')::uuid and user_id=p_user_id and session_id=o.session_id;
  if not found or task.revision<>(p_input->>'revision')::integer then raise exception 'revision_conflict';end if;
  select r.plan into plan from public.commerce_revisions r where r.task_id=task.id and r.revision=task.revision;
  if plan->>'scene'<>'detail' or plan#>>'{brief,name}' is distinct from o.state#>>'{review,name}' or plan#>>'{brief,facts}' is distinct from o.state#>>'{review,facts}' or jsonb_array_length(plan->'slots')<>(q.snapshot->>'outputCount')::integer then raise exception 'package_plan_changed';end if;
  for spec in select unnest(array['product','style']) loop
   select coalesce(jsonb_agg(r->>'id' order by r->>'id'),'[]') into expected_refs from jsonb_array_elements(q.reference_binding)r where r->>'role'=spec;
   select coalesce(jsonb_agg(x order by x),'[]') into refs from jsonb_array_elements_text(plan#>array['brief',case when spec='product' then 'productReferenceIds' else 'styleReferenceIds' end])x;
   if refs is distinct from expected_refs then raise exception 'package_references_changed';end if;
  end loop;
  idx:=0;
  for slot in select value from jsonb_array_elements(plan->'slots') loop
   module_name:=q.snapshot#>>array['selection','modules',(idx%jsonb_array_length(q.snapshot#>'{selection,modules}'))::text];
   spec:=case when (q.snapshot#>>'{selection,advanced}')::boolean then case when idx<jsonb_array_length(q.snapshot#>'{selection,modules}') then 'desktop' else 'mobile' end else 'standard' end;
   if slot->>'module' is distinct from module_name or slot->>'outputSpec' is distinct from spec or slot->>'provider'<>'seedream' or slot->>'model' is distinct from q.snapshot#>>'{costs,imageModel}' or slot->>'resolution'<>'2K' then raise exception 'package_plan_changed';end if;
   idx:=idx+1;
  end loop;
  update private.commerce_package_orders set state=o.state||jsonb_build_object('taskId',task.id,'taskRevision',task.revision) where id=oid;
  perform set_config('zimage.package_order',oid::text,true);
  perform set_config('zimage.credit_version',(select version from private.credit_settings where singleton),true);
  select jsonb_agg(s->>'id' order by pos) into refs from jsonb_array_elements(plan->'slots')with ordinality x(s,pos);
  submit_body:=jsonb_build_object('requestId',o.request_id,'revision',task.revision,'slotIds',refs,'recreate',false,'source','direct');
  result:=private.commerce_dispatch(p_user_id,'submit',task.id,submit_body,md5(oid::text||submit_body::text),'[]',gen_random_uuid());
  perform set_config('zimage.package_order','',true);perform set_config('zimage.credit_version','',true);
  update private.commerce_package_orders set revision=revision+1,updated_at=now() where id=oid returning * into o;
  insert into private.commerce_package_events(order_id,revision,kind,data)values(oid,o.revision,'images_submitted',jsonb_build_object('taskId',task.id));
  return private.commerce_package_projection(oid);
 end if;
 raise exception 'invalid_package_action';
end $$;

create or replace function private.credit_generation_admit() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.generation_batches%rowtype;version text;oid uuid;o private.commerce_package_orders%rowtype;s jsonb;pos integer;
begin
 oid:=nullif(current_setting('zimage.package_order',true),'')::uuid;
 if oid is not null then
  select * into o from private.commerce_package_orders where id=oid for update;
  select * into b from public.generation_batches where id=new.batch_id;
  if not found or o.settled or o.state->>'status'<>'active' or o.user_id<>b.user_id or o.session_id<>b.session_id or new.model is distinct from o.state#>>'{quote,costs,imageModel}' or new.provider<>'seedream' then raise exception 'invalid_package_funding';end if;
  select value,ordinality::integer-1 into s,pos from jsonb_array_elements(o.state->'stages')with ordinality where value->>'kind'='image' and value->>'status'='pending' order by ordinality limit 1;
  if s is null then raise exception 'package_output_limit';end if;
  s:=s||jsonb_build_object('status','processing','generationId',new.id);
  insert into private.commerce_package_generations values(oid,s->>'key',new.id);
  update private.commerce_package_orders set state=jsonb_set(state,array['stages',pos::text],s)where id=oid;
  return new;
 end if;
 if not(select enabled from private.credit_settings where singleton)then return new;end if;
 select s.version into version from private.credit_settings s where singleton for share;
 if current_setting('zimage.credit_version',true) is distinct from version then raise exception 'credit_price_changed';end if;
 select * into b from public.generation_batches where id=new.batch_id;
 perform private.credit_reserve(b.user_id,'image:'||new.id,new.id::text,jsonb_build_object('operation','image','provider',new.provider,'model',new.model,'resolution',new.params->>'resolution','count',1),new.id);
 return new;
end $$;
create function private.commerce_package_generation_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;o private.commerce_package_orders%rowtype;stages jsonb;s jsonb;w private.generation_work%rowtype;key text;
begin
 select order_id,stage_key into oid,key from private.commerce_package_generations where generation_id=case when tg_op='DELETE'then old.id else new.id end;
 if oid is not null then
  if tg_op='DELETE'then
   select * into o from private.commerce_package_orders where id=oid for update;
   if not o.settled and old.provider_submission_state='not_submitted'then
    select * into w from private.generation_work where generation_id=old.id;
    if coalesce(w.phase,'') not in ('submitted','result','uploaded','unknown')then
     select jsonb_agg(case when j->>'key'=key and j->>'status' not in ('succeeded','failed')then j||'{"status":"failed","failure":"deleted_before_provider_submission"}'::jsonb else j end order by pos)into stages from jsonb_array_elements(o.state->'stages')with ordinality x(j,pos);
     if stages is distinct from o.state->'stages'then
      update private.commerce_package_orders set state=jsonb_set(state,'{stages}',stages),revision=revision+1 where id=oid returning * into o;
      insert into private.commerce_package_events(order_id,revision,kind,data)values(oid,o.revision,'generation_deleted',jsonb_build_object('generationId',old.id,'providerState',old.provider_submission_state));
     end if;
    end if;
   end if;
  end if;
  perform private.commerce_package_refresh(oid);
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
create trigger package_generation_changed after update of status,error_code,provider_submission_state on public.generations for each row execute function private.commerce_package_generation_changed();
create trigger package_generation_deleted after delete on public.generations for each row execute function private.commerce_package_generation_changed();
create function private.commerce_package_work_changed()returns trigger language plpgsql security definer set search_path=''as $$
declare oid uuid;begin select order_id into oid from private.commerce_package_generations where generation_id=new.generation_id;
 if oid is not null then perform private.commerce_package_refresh(oid);end if;return new;end $$;
create trigger package_work_changed after update of phase,provider_outcome,result on private.generation_work for each row execute function private.commerce_package_work_changed();
create function private.commerce_package_session_closing()returns trigger language plpgsql security definer set search_path=''as $$
declare sid uuid;o private.commerce_package_orders%rowtype;stages jsonb;
begin
 sid:=case when tg_op='DELETE'then old.id else new.id end;
 if tg_op='UPDATE'and new.status<>'deleting'then return new;end if;
 for o in select * from private.commerce_package_orders x where x.session_id=sid and not x.settled order by x.id for update loop
  if not exists(select 1 from private.commerce_package_generations where order_id=o.id)then
   select jsonb_agg(case when j->>'status' in ('succeeded','failed')then j else j||'{"status":"skipped"}'::jsonb end order by pos)into stages from jsonb_array_elements(o.state->'stages')with ordinality x(j,pos);
   update private.commerce_package_orders set state=state||jsonb_build_object('status','cancelled','stages',stages),revision=revision+1 where id=o.id returning * into o;
   insert into private.commerce_package_events(order_id,revision,kind,data)values(o.id,o.revision,'session_closed_before_images','{}');
   perform private.commerce_package_finish(o.id);
  else perform private.commerce_package_refresh(o.id);end if;
 end loop;
 if tg_op='DELETE'then return old;end if;return new;
end $$;
create trigger package_session_closing after update of status on public.sessions for each row execute function private.commerce_package_session_closing();
create trigger package_session_deleting before delete on public.sessions for each row execute function private.commerce_package_session_closing();

-- Covers cached/legacy dispatchers as well as the current Web path.
create function private.commerce_package_run_admit()returns trigger language plpgsql security definer set search_path=''as $$
declare oid uuid;begin
 if exists(select 1 from private.commerce_package_orders o where o.state->>'taskId'=new.task_id::text)then
  oid:=nullif(current_setting('zimage.package_order',true),'')::uuid;
  if oid is null or not exists(select 1 from private.commerce_package_orders o join public.commerce_tasks t on t.id=new.task_id and t.user_id=o.user_id where o.id=oid and not o.settled and o.state->>'taskId'=new.task_id::text and (o.state->>'taskRevision')::integer=new.revision)then raise exception 'package_order_required';end if;
 end if;return new;
end $$;
create trigger package_run_admit before insert on public.commerce_runs for each row execute function private.commerce_package_run_admit();
create index package_order_task on private.commerce_package_orders((state->>'taskId'))where state?'taskId';
-- All private state and cost snapshots remain server-only, including service table access.
do $$declare n text;begin
 foreach n in array array['commerce_package_cost_versions','commerce_package_sale_versions','commerce_package_settings','commerce_package_quotes','commerce_package_orders','commerce_package_events','commerce_package_generations']loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);end loop;
end $$;
revoke all on function public.commerce_package_dispatch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_package_dispatch(uuid,text,jsonb) to service_role;
do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'commerce_package_%' or p.proname='credit_settle_legacy')loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;end $$;
create or replace function private.commerce_task_json(p_task_id uuid) returns jsonb
language sql set search_path = '' as $$
  select r.plan || coalesce((select jsonb_build_object('packageOrderId',p.id)from private.commerce_package_orders p where p.state->>'taskId'=t.id::text and p.user_id=t.user_id order by p.created_at desc limit 1),'{}'::jsonb) || jsonb_build_object(
    'id',t.id,'sessionId',t.session_id,'revision',t.revision,'createdAt',t.created_at,
    'updatedAt',t.updated_at,'archived',t.archived,
    'slotHashes',coalesce((select jsonb_object_agg(c.slot_id::text,c.compiled->>'hash')
      from private.commerce_compiled_slots c where c.task_id=t.id and c.revision=t.revision),'{}'::jsonb),
    'runs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',run.id,'revision',run.revision,'requestId',run.request_id,'createdAt',run.created_at,
      'items',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'slotId',i.slot_id,'batchId',i.batch_id,'generationId',i.generation_id,'status',g.status,
        'error',g.error_code,'expired',g.status='succeeded' and
          (g.asset_status is distinct from 'active' or coalesce(g.asset_expires_at <= clock_timestamp(),true)),
        'compatibilityHash',i.compatibility_hash,'selectionVersion',i.selection_version)) order by i.position)
        from public.commerce_run_items i join public.generations g on g.id=i.generation_id
        where i.run_id=run.id),'[]'::jsonb)) order by run.created_at,run.id)
      from public.commerce_runs run where run.task_id=t.id),'[]'::jsonb),
    'selections',coalesce((select jsonb_agg(jsonb_build_object('slotId',s.slot_id,'generationId',s.generation_id,
      'compatibilityHash',s.compatibility_hash,'version',s.selection_version) order by slot.ordinality)
      from public.commerce_selections s join jsonb_array_elements(r.plan->'slots') with ordinality slot(value,ordinality)
        on (slot.value->>'id')::uuid=s.slot_id
      where s.task_id=t.id and s.generation_id is not null),'[]'::jsonb))
  from public.commerce_tasks t join public.commerce_revisions r on r.task_id=t.id and r.revision=t.revision
  where t.id=p_task_id;
$$;

