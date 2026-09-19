-- Additive billing. Activate separately after compatible Web/Worker verification.
create table private.credit_price_versions(version text primary key, prices jsonb not null check(jsonb_typeof(prices)='array'), created_at timestamptz not null default now());
insert into private.credit_price_versions values ('2026-09-15.1','[
 {"operation":"image","provider":"seedream","model":"seedream-4.5","resolution":"2K","unitMinor":30,"label":"Seedream 4.5"},
 {"operation":"image","provider":"gemini","model":"gemini-3-pro-image","resolution":"1K","unitMinor":60,"label":"Gemini 3 Pro Image"},
 {"operation":"image","provider":"gemini","model":"gemini-3-pro-image","resolution":"2K","unitMinor":80,"label":"Gemini 3 Pro Image"},
 {"operation":"chat","provider":"doubao","model":"doubao","resolution":"","unitMinor":2,"label":"豆包"},
 {"operation":"chat","provider":"minimax","model":"minimax","resolution":"","unitMinor":3,"label":"MiniMax"},
 {"operation":"optimize","provider":"doubao","model":"doubao","resolution":"","unitMinor":5,"label":"豆包文字优化"},
 {"operation":"optimize","provider":"minimax","model":"minimax","resolution":"","unitMinor":10,"label":"MiniMax 文字优化"}
]',now());
create table private.credit_settings(singleton boolean primary key default true check(singleton), enabled boolean not null default false, version text not null references private.credit_price_versions);
insert into private.credit_settings values(true,false,'2026-09-15.1');
create table private.credit_wallets(user_id uuid primary key references auth.users(id) on delete cascade, available_minor bigint not null default 0 check(available_minor>=0), frozen_minor bigint not null default 0 check(frozen_minor>=0), spent_minor bigint not null default 0 check(spent_minor>=0));
create table private.credit_operations(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 business_key text not null, request_hash text not null, operation text not null check(operation in ('image','chat','optimize')),
 model text not null, version text not null references private.credit_price_versions, amount_minor bigint not null check(amount_minor>0),
 status text not null default 'reserved' check(status in ('reserved','processing','result','succeeded','refunded','needs_review')),
 original_generation_id uuid, session_id uuid, result jsonb, started jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,business_key));
create unique index credit_generation_key on private.credit_operations(original_generation_id) where original_generation_id is not null;
create table private.credit_requests(user_id uuid not null references auth.users(id) on delete cascade,request_id uuid not null,request_hash text not null,result jsonb not null,primary key(user_id,request_id));
create table private.credit_ledger(id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid references private.credit_operations(id) on delete cascade,kind text not null check(kind in ('grant','reserve','capture','release','review')),amount_minor bigint not null check(amount_minor>=0),business_key text not null,reason text,created_at timestamptz not null default now(),unique(user_id,business_key));
create index credit_ledger_user_cursor on private.credit_ledger(user_id,id desc);
create table private.credit_admin_audit(id bigint generated always as identity primary key,request_id uuid unique not null,input jsonb not null,created_at timestamptz not null default now());

do $$ declare n text; begin foreach n in array array['credit_wallets','credit_operations','credit_requests','credit_ledger','credit_price_versions','credit_settings','credit_admin_audit'] loop
 execute format('alter table private.%I enable row level security',n);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
end loop; end $$;

create function private.credit_wallet(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users u join public.account_profiles p on p.user_id=u.id where u.id=p_user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,true) and u.deleted_at is null and p.status='active') then raise exception 'unauthorized'; end if;
 insert into private.credit_wallets(user_id) values(p_user_id) on conflict do nothing;
 insert into private.credit_ledger(user_id,kind,amount_minor,business_key,reason) values(p_user_id,'grant',1000,'welcome:v1','首次验证账号赠送') on conflict do nothing;
 if found then update private.credit_wallets set available_minor=available_minor+1000 where user_id=p_user_id; end if;
end $$;

create function private.credit_quote(p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings private.credit_settings%rowtype; prices jsonb; item jsonb; price jsonb; lines jsonb:='[]'; total bigint:=0; amount bigint; quantity integer;
begin
 select * into settings from private.credit_settings where singleton for share;
 if not settings.enabled then raise exception 'credits_disabled'; end if;
 select v.prices into prices from private.credit_price_versions v where v.version=settings.version;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 8 then raise exception 'invalid_credit_items'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  quantity:=(item->>'count')::integer;
  if quantity is null or quantity not between 1 and 8 then raise exception 'invalid_credit_count'; end if;
  select p into price from jsonb_array_elements(prices) p where p->>'operation'=item->>'operation' and p->>'provider'=item->>'provider' and p->>'model'=item->>'model' and p->>'resolution'=coalesce(item->>'resolution','');
  if price is null then raise exception 'credit_price_unavailable'; end if;
  amount:=(price->>'unitMinor')::bigint*quantity; total:=total+amount;
  lines:=lines||jsonb_build_array(item||jsonb_build_object('unitMinor',(price->>'unitMinor')::bigint,'totalMinor',amount));
 end loop;
 return jsonb_build_object('version',settings.version,'totalMinor',total,'items',lines);
end $$;
create function private.credit_check(p_quote jsonb,p_confirmation jsonb) returns void language plpgsql set search_path='' as $$
begin
 if p_confirmation is null or (p_confirmation->>'version') is distinct from (p_quote->>'version') or (p_confirmation->>'totalMinor')::bigint is distinct from (p_quote->>'totalMinor')::bigint then raise exception 'credit_price_changed'; end if;
end $$;
create function private.credit_reserve(p_user_id uuid,p_key text,p_hash text,p_item jsonb,p_generation uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare q jsonb; oid uuid; prior private.credit_operations%rowtype; amount bigint;
begin
 perform private.credit_wallet(p_user_id);
 select * into prior from private.credit_operations where user_id=p_user_id and business_key=p_key;
 if found then if prior.request_hash<>p_hash then raise exception 'idempotency_conflict'; end if; return prior.id; end if;
 q:=private.credit_quote(jsonb_build_array(p_item)); amount:=(q->>'totalMinor')::bigint;
 update private.credit_wallets set available_minor=available_minor-amount,frozen_minor=frozen_minor+amount where user_id=p_user_id and available_minor>=amount;
 if not found then raise exception 'insufficient_credits'; end if;
 insert into private.credit_operations(user_id,business_key,request_hash,operation,model,version,amount_minor,original_generation_id)
 values(p_user_id,p_key,p_hash,p_item->>'operation',p_item->>'model',q->>'version',amount,p_generation) returning id into oid;
 insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key) values(p_user_id,oid,'reserve',amount,'reserve:'||oid);
 return oid;
end $$;
create function private.credit_settle(p_id uuid,p_status text,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$
declare op private.credit_operations%rowtype; kind text;
begin
 select * into op from private.credit_operations where id=p_id for update;
 if not found or op.status in ('succeeded','refunded') then return; end if;
 if p_status not in ('succeeded','refunded','needs_review') then raise exception 'invalid_credit_status'; end if;
 if p_status='refunded' and op.result is not null then raise exception 'credit_result_must_complete'; end if;
 if p_status='needs_review' then
  if op.status='result' then return; end if; -- preserve a durable result for completion recovery
  update private.credit_operations set status='needs_review',updated_at=now() where id=p_id;
  insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason) values(op.user_id,op.id,'review',op.amount_minor,'review:'||op.id,p_reason) on conflict do nothing;
  return;
 end if;
 kind:=case when p_status='succeeded' then 'capture' else 'release' end;
 update private.credit_wallets set frozen_minor=frozen_minor-op.amount_minor,available_minor=available_minor+case when p_status='refunded' then op.amount_minor else 0 end,spent_minor=spent_minor+case when p_status='succeeded' then op.amount_minor else 0 end where user_id=op.user_id;
 update private.credit_operations set status=p_status,updated_at=now() where id=op.id;
 insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason) values(op.user_id,op.id,kind,op.amount_minor,kind||':'||op.id,p_reason);
end $$;

-- Admission trigger covers every ordinary/commerce/recreate path, including legacy RPC callers.
create function private.credit_generation_admit() returns trigger language plpgsql security definer set search_path='' as $$
declare b public.generation_batches%rowtype; version text;
begin
 if not (select enabled from private.credit_settings where singleton) then return new; end if;
 select s.version into version from private.credit_settings s where singleton for share;
 if current_setting('zimage.credit_version',true) is distinct from version then raise exception 'credit_price_changed'; end if;
 select * into b from public.generation_batches where id=new.batch_id;
 perform private.credit_reserve(b.user_id,'image:'||new.id,new.id::text,jsonb_build_object('operation','image','provider',new.provider,'model',new.model,'resolution',new.params->>'resolution','count',1),new.id);
 return new;
end $$;
create trigger credit_generation_admit after insert on public.generations for each row execute function private.credit_generation_admit();
create function private.credit_generation_finish() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; submitted text; work_phase text;
begin
 select id into oid from private.credit_operations where original_generation_id=old.id;
 if oid is null then if tg_op='DELETE' then return old; end if;return null; end if; -- never back-charge old work
 if tg_op='DELETE' then
  select phase into work_phase from private.generation_work where generation_id=old.id;
  perform private.credit_settle(oid,case when old.provider_submission_state='not_submitted' and coalesce(work_phase,'') not in ('submitted','result','uploaded','unknown') then 'refunded' else 'needs_review' end,'内容已删除');
 elsif new.status='succeeded' then perform private.credit_settle(oid,'succeeded');
 elsif new.error_code in ('provider_result_unknown','provider_reconciliation_required','result_storage_failed','storage_error','storage_pending','result_pending_storage') then perform private.credit_settle(oid,'needs_review',new.error_code);
 elsif new.status='failed' then
  select phase,provider_outcome into work_phase,submitted from private.generation_work where generation_id=new.id;
  -- The fenced worker records a definite rejection after updating the generation, in the same transaction.
  if new.provider_submission_state='submitted' and work_phase='submitted' and submitted is null then return null; end if;
  perform private.credit_settle(oid,case when new.provider_submission_state='unknown' or new.error_code in ('provider_result_unknown','provider_reconciliation_required','result_storage_failed','storage_error','storage_pending','result_pending_storage') or (new.provider_submission_state='submitted' and submitted is distinct from 'rejected') then 'needs_review' else 'refunded' end,new.error_code);
 end if;
 if tg_op='DELETE' then return old; end if;
 return null;
end $$;
create trigger credit_generation_finish after update of status,error_code,provider_submission_state on public.generations for each row execute function private.credit_generation_finish();
create trigger credit_generation_delete before delete on public.generations for each row execute function private.credit_generation_finish();

-- Observe the journal boundary as well as the generation row. Both updates occur
-- within the worker RPC transaction, so rejected calls release exactly once.
create function private.credit_work_finish() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
 select id into oid from private.credit_operations where original_generation_id=new.generation_id;
 if oid is null then return null;end if;
 if new.phase='cancelled' and new.provider_outcome='rejected' and exists(select 1 from public.generations where id=new.generation_id and status='failed') then perform private.credit_settle(oid,'refunded','模型明确拒绝');
 elsif new.phase='unknown' then perform private.credit_settle(oid,'needs_review','上游结果待核对');end if;
 return null;
end $$;
create trigger credit_work_finish after update of phase,provider_outcome on private.generation_work for each row execute function private.credit_work_finish();

create function public.get_commerce_capabilities() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'contentPosters',position('xhs-poster' in pg_get_functiondef('private.commerce_validate_plan(jsonb,jsonb)'::regprocedure))>0);
$$;

-- Trusted quote reconstruction; the client cannot pick cheaper items for a saved task.
create function private.credit_items(p_user_id uuid,p_action text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.generation_batches%rowtype; n integer; items jsonb; cfg jsonb;
begin
 if p_action='image' then cfg:=p_input->'config'; return jsonb_build_array(jsonb_build_object('operation','image','provider',p_input->>'provider','model',p_input->>'model','resolution',cfg->>'resolution','count',(cfg->>'count')::integer));
 elsif p_action='commerce' then
  select jsonb_agg(jsonb_build_object('operation','image','provider',c.compiled->>'provider','model',c.compiled->>'model','resolution',c.compiled#>>'{config,resolution}','count',1) order by c.slot_id) into items
  from private.commerce_compiled_slots c join public.commerce_tasks t on t.id=c.task_id where t.user_id=p_user_id and t.id=(p_input->>'taskId')::uuid and t.revision=(p_input->>'revision')::integer and c.revision=t.revision and c.slot_id in (select value::uuid from jsonb_array_elements_text(p_input->'slotIds'));
  if items is null or jsonb_array_length(items)<>jsonb_array_length(p_input->'slotIds') then raise exception 'revision_conflict'; end if; return items;
 elsif p_action='recreate' then
  select * into b from public.generation_batches where id=(p_input->>'batchId')::uuid and user_id=p_user_id;
  if not found then raise exception 'batch_not_found'; end if;
  select count(*) into n from public.generations g where g.batch_id=b.id and (p_input->>'mode'='all' or (p_input->>'mode'='single' and g.id=(p_input->>'generationId')::uuid) or (p_input->>'mode'='failed' and g.status='failed' and g.provider_submission_state<>'unknown' and coalesce(g.error_code,'') not in ('provider_result_unknown','result_storage_failed','provider_reconciliation_required') and not (g.provider_submission_state='submitted' and coalesce(g.error_code,'') in ('provider_error','provider_unavailable') and not exists(select 1 from private.generation_work w where w.generation_id=g.id and w.provider_outcome='rejected'))));
  return jsonb_build_array(jsonb_build_object('operation','image','provider',b.provider,'model',b.model,'resolution',b.config->>'resolution','count',n));
 end if;
 raise exception 'invalid_credit_action';
end $$;

create function public.credit_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare settings private.credit_settings%rowtype; q jsonb; result jsonb; req uuid; h text; prior private.credit_requests%rowtype; op private.credit_operations%rowtype; oid uuid; item jsonb; v_started jsonb; mid uuid;
begin
 if p_action='catalog' then select * into settings from private.credit_settings where singleton; return (select jsonb_build_object('version',settings.version,'enabled',settings.enabled,'prices',prices) from private.credit_price_versions where version=settings.version); end if;
 -- Follow existing account -> session -> generation -> wallet lock order.
 perform 1 from public.account_profiles where user_id=p_user_id and status='active' for update;
 if not found then raise exception 'unauthorized'; end if;
 perform private.credit_wallet(p_user_id);
 if p_action='wallet' then return (select jsonb_build_object('availableMinor',available_minor,'frozenMinor',frozen_minor,'spentMinor',spent_minor) from private.credit_wallets where user_id=p_user_id);
 elsif p_action='ledger' then
  select coalesce(jsonb_agg(row order by (row->>'id')::bigint desc),'[]') into result from (
   select jsonb_build_object('id',l.id::text,'createdAt',l.created_at,'kind',l.kind,'amountMinor',l.amount_minor,'operation',o.operation,'model',o.model,'status',o.status,'reason',l.reason) as row
   from private.credit_ledger l left join private.credit_operations o on o.id=l.operation_id where l.user_id=p_user_id and (nullif(p_input->>'cursor','') is null or l.id<(p_input->>'cursor')::bigint) order by l.id desc limit 30
  ) r; return jsonb_build_object('items',result,'nextCursor',case when jsonb_array_length(result)=30 then result->29->>'id' end);
 elsif p_action='quote' then return private.credit_quote(case when p_input ? 'action' then private.credit_items(p_user_id,p_input->>'action',p_input->'input') else p_input->'items' end);
 end if;
 req:=(p_input->>'requestId')::uuid;
 if req is null then raise exception 'credit_request_id_required'; end if;
 h:=md5(p_action||((p_input-'billing'-'correlationId')::text));
 if p_action in ('image','recreate','commerce') then
  select * into prior from private.credit_requests where user_id=p_user_id and request_id=req;
  if found then if prior.request_hash<>h then raise exception 'idempotency_conflict'; end if; return prior.result; end if;
  q:=private.credit_quote(private.credit_items(p_user_id,p_action,p_input)); perform private.credit_check(q,p_input->'billing');
  perform set_config('zimage.credit_version',q->>'version',true);
  if p_action='image' then
   if p_input ? 'chatMessage' then v_started:=private.start_chat_turn(p_user_id,(p_input->>'sessionId')::uuid,p_input->>'chatMessage');p_input:=p_input||jsonb_build_object('sessionId',v_started#>>'{session,id}');end if;
   result:=private.submit_image_generation(p_user_id,(p_input->>'sessionId')::uuid,p_input->>'prompt',p_input->>'provider',p_input->>'model',p_input->'config',coalesce(p_input->>'source','direct'),null,p_input->>'skillId',p_input->>'skillVersion',req::text,p_input->>'requestHash',(p_input->>'correlationId')::uuid);
   if p_input ? 'chatMessage' then mid:=private.complete_chat_turn(p_user_id,(result->>'sessionId')::uuid,'已创建图片生成任务，你可以继续聊天或提交下一批。');result:=result||jsonb_build_object('toolMessageId',mid);end if;
  elsif p_action='recreate' then
   result:=private.recreate_image_generation(p_user_id,(p_input->>'batchId')::uuid,p_input->>'mode',(p_input->>'generationId')::uuid,req::text,p_input->>'requestHash',(p_input->>'correlationId')::uuid);
  else
   result:=private.commerce_dispatch(p_user_id,'submit',(p_input->>'taskId')::uuid,p_input-'taskId'-'billing'-'correlationId',p_input->>'requestHash','[]',(p_input->>'correlationId')::uuid);
  end if;
  perform set_config('zimage.credit_version','',true);
  insert into private.credit_requests values(p_user_id,req,h,result); return result;
 end if;
 if p_action='text_start' then
  select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||req;
  if found then if op.request_hash<>md5((p_input-'billing'-'correlationId')::text) then raise exception 'idempotency_conflict'; end if; return to_jsonb(op); end if;
  item:=jsonb_build_object('operation',p_input->>'operation','provider',p_input->>'model','model',p_input->>'model','resolution','','count',1);
  if item->>'operation' not in ('chat','optimize') then raise exception 'invalid_credit_operation'; end if;
  q:=private.credit_quote(jsonb_build_array(item));perform private.credit_check(q,p_input->'billing');
  oid:=private.credit_reserve(p_user_id,'text:'||req,md5((p_input-'billing'-'correlationId')::text),item);
  if p_input->>'operation'='chat' then v_started:=private.start_chat_turn(p_user_id,(p_input#>>'{input,sessionId}')::uuid,p_input#>>'{input,message}'); end if;
  update private.credit_operations set started=v_started,session_id=(v_started#>>'{session,id}')::uuid where id=oid returning * into op; return to_jsonb(op);
 end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||req for update;
 if not found then raise exception 'credit_operation_not_found'; end if;
 if p_action='text_claim' then
  if op.status<>'reserved' then return jsonb_build_object('claimed',false,'operation',to_jsonb(op)); end if;
  update private.credit_operations set status='processing',updated_at=now() where id=op.id;
  return jsonb_build_object('claimed',true);
 elsif p_action='text_result' then
  if op.status not in ('processing','needs_review') then return to_jsonb(op); end if;
  if jsonb_typeof(p_input->'result') is distinct from 'object' then raise exception 'invalid_credit_result'; end if;
  update private.credit_operations set result=p_input->'result',status='result',updated_at=now() where id=op.id returning * into op; return to_jsonb(op);
 elsif p_action='text_complete' then
  if op.status='succeeded' then return to_jsonb(op); end if;
  if op.status<>'result' or op.result is null then raise exception 'credit_result_pending'; end if;
  if op.operation='chat' then
   if exists(select 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active') then mid:=private.complete_chat_turn(p_user_id,op.session_id,op.result->>'content');else mid:=op.id;end if;
   update private.credit_operations set result=private.credit_operations.result||jsonb_build_object('messageId',mid) where id=op.id;
  end if;
  perform private.credit_settle(op.id,'succeeded');
 elsif p_action='text_cancel' then
  if op.status='reserved' then perform private.credit_settle(op.id,'refunded',p_input->>'reason'); end if;
 elsif p_action='text_refund' then perform private.credit_settle(op.id,'refunded',p_input->>'reason');
 elsif p_action='text_unknown' then perform private.credit_settle(op.id,'needs_review',p_input->>'reason');
 else raise exception 'invalid_credit_action'; end if;
 select * into op from private.credit_operations where id=op.id; return to_jsonb(op);
end $$;

-- Named, audited operations only; this is never exposed as a public Web endpoint.
create function public.credit_admin(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; prior jsonb; amount bigint; item jsonb; existing private.credit_operations%rowtype;
begin
 if length(btrim(coalesce(p_input->>'reason','')))<3 or length(btrim(coalesce(p_input->>'actor','')))<1 then raise exception 'credit_audit_reason_required'; end if;
 if p_input->>'action' not in ('grant','price','reconcile','activate','audit') then raise exception 'invalid_credit_admin_action'; end if;
 if p_input->>'action'='audit' then
  uid:=(p_input->>'userId')::uuid;if uid is null then raise exception 'invalid_credit_user';end if;
  return (select jsonb_build_object('wallet',to_jsonb(w),'ledgerAvailable',l.available,'ledgerFrozen',l.frozen,'ledgerSpent',l.spent,'consistent',w.available_minor=l.available and w.frozen_minor=l.frozen and w.spent_minor=l.spent,'pending',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'status',o.status,'amountMinor',o.amount_minor,'model',o.model,'createdAt',o.created_at)),'[]') from private.credit_operations o where o.user_id=uid and o.status not in ('succeeded','refunded'))) from private.credit_wallets w cross join lateral (select coalesce(sum(case when kind in ('grant','release') then amount_minor when kind='reserve' then -amount_minor else 0 end),0) as available,coalesce(sum(case when kind='reserve' then amount_minor when kind in ('capture','release') then -amount_minor else 0 end),0) as frozen,coalesce(sum(amount_minor) filter(where kind='capture'),0) as spent from private.credit_ledger where user_id=uid) l where w.user_id=uid);
 end if;
 if not coalesce((p_input->>'apply')::boolean,false) then
  return jsonb_build_object('dryRun',true,'proposed',p_input,'settings',(select to_jsonb(s) from private.credit_settings s),'walletBefore',(select to_jsonb(w) from private.credit_wallets w where user_id=(p_input->>'userId')::uuid),'availableAfterGrant',(select available_minor+(p_input->>'amountMinor')::bigint from private.credit_wallets where user_id=(p_input->>'userId')::uuid),'operation',(select to_jsonb(o) from private.credit_operations o where id=(p_input->>'operationId')::uuid));
 end if;
 if p_input->>'requestId' is null then raise exception 'credit_request_id_required'; end if;
 select input into prior from private.credit_admin_audit where request_id=(p_input->>'requestId')::uuid;
 if found then if prior<>p_input then raise exception 'idempotency_conflict'; end if;return jsonb_build_object('replayed',true); end if;
 if p_input->>'action'='grant' then
  uid:=(p_input->>'userId')::uuid;amount:=(p_input->>'amountMinor')::bigint;
  if amount is null or amount not between 1 and 100000000 then raise exception 'invalid_credit_amount'; end if;
  perform 1 from public.account_profiles where user_id=uid and status='active' for update;perform private.credit_wallet(uid);
  insert into private.credit_ledger(user_id,kind,amount_minor,business_key,reason) values(uid,'grant',amount,'admin:'||(p_input->>'requestId'),p_input->>'reason') on conflict do nothing;
  if found then update private.credit_wallets set available_minor=available_minor+amount where user_id=uid; end if;
 elsif p_input->>'action'='activate' then update private.credit_settings set enabled=(p_input->>'enabled')::boolean;
 elsif p_input->>'action'='price' then
  if coalesce(length(p_input->>'version'),0) not between 1 and 100 then raise exception 'invalid_credit_version'; end if;
  if jsonb_typeof(p_input->'prices') is distinct from 'array' or jsonb_array_length(p_input->'prices')<>7 then raise exception 'invalid_credit_prices'; end if;
  for item in select value from jsonb_array_elements(p_input->'prices') loop
   if jsonb_typeof(item->'label') is distinct from 'string' or coalesce(length(item->>'label'),0) not between 1 and 100 or item->>'unitMinor' is null or jsonb_typeof(item->'unitMinor') is distinct from 'number' or (item->>'unitMinor') !~ '^[0-9]+$' or (item->>'unitMinor')::bigint not between 1 and 1000000 or not exists(select 1 from private.credit_price_versions v,jsonb_array_elements(v.prices) p where v.version='2026-09-15.1' and (p-'unitMinor'-'label')=(item-'unitMinor'-'label')) then raise exception 'invalid_credit_prices'; end if;
  end loop;
  if (select count(distinct (p-'unitMinor'-'label')) from jsonb_array_elements(p_input->'prices') p)<>7 then raise exception 'invalid_credit_prices'; end if;
  insert into private.credit_price_versions(version,prices) values(p_input->>'version',p_input->'prices');update private.credit_settings set version=p_input->>'version';
 elsif p_input->>'action'='reconcile' then
  select * into existing from private.credit_operations where id=(p_input->>'operationId')::uuid;
  perform 1 from public.account_profiles where user_id=existing.user_id for update;
  select * into existing from private.credit_operations where id=(p_input->>'operationId')::uuid for update;
  if existing.id is null or existing.status not in ('needs_review','result','processing') or length(coalesce(p_input->>'evidence',''))<10 then raise exception 'credit_reconciliation_evidence_required'; end if;
  if p_input->>'outcome' not in ('succeeded','refunded') then raise exception 'invalid_credit_status'; end if;
  if existing.result is not null and p_input->>'outcome'='refunded' then raise exception 'credit_result_must_complete'; end if;
  if existing.operation in ('chat','optimize') and p_input->>'outcome'='succeeded' then
   if existing.result is null then
    if jsonb_typeof(p_input->'result') is distinct from 'object' or (existing.operation='chat' and coalesce(length(p_input#>>'{result,content}'),0) not between 1 and 64000) or (existing.operation='optimize' and coalesce(length(p_input#>>'{result,text}'),0) not between 1 and 6000) then raise exception 'credit_reconciliation_result_required'; end if;
    perform public.credit_dispatch(existing.user_id,'text_result',jsonb_build_object('requestId',substring(existing.business_key from 6),'result',p_input->'result'));
   end if;
   perform public.credit_dispatch(existing.user_id,'text_complete',jsonb_build_object('requestId',substring(existing.business_key from 6)));
  else perform private.credit_settle(existing.id,p_input->>'outcome',p_input->>'reason');end if;
 else raise exception 'invalid_credit_admin_action'; end if;
 insert into private.credit_admin_audit(request_id,input) values((p_input->>'requestId')::uuid,p_input);
 return jsonb_build_object('applied',true);
end $$;

-- Grant once to existing verified active accounts. New accounts receive the same
-- idempotent grant when their first authenticated wallet operation arrives.
do $$ declare uid uuid; begin for uid in select u.id from auth.users u join public.account_profiles p on p.user_id=u.id where u.email_confirmed_at is not null and not coalesce(u.is_anonymous,true) and u.deleted_at is null and p.status='active' loop perform private.credit_wallet(uid); end loop; end $$;
revoke all on function public.credit_dispatch(uuid,text,jsonb),public.credit_admin(jsonb),public.get_commerce_capabilities() from public,anon,authenticated;
grant execute on function public.credit_dispatch(uuid,text,jsonb),public.credit_admin(jsonb),public.get_commerce_capabilities() to service_role;
do $$ declare f record;begin for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'credit_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end $$;
