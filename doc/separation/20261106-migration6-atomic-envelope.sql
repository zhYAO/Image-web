DO $zimage_m6_atomic$
BEGIN
  EXECUTE $zimage_m6_source$
-- Disabled local candidate. Every live tariff requires explicit operator approval.
create table private.chat_usage_versions(version text primary key,tariff jsonb not null,created_at timestamptz not null default now());
create table private.chat_usage_settings(model text primary key check(model in('doubao','gpt-6-astra','gpt-6.1-sol')),enabled boolean not null default false,version text references private.chat_usage_versions);
insert into private.chat_usage_settings(model)values('doubao'),('gpt-6-astra'),('gpt-6.1-sol');
create table private.chat_usage_operations(operation_id uuid primary key references private.credit_operations(id)on delete cascade,tariff jsonb not null,receipt jsonb,settlement jsonb,settled boolean not null default false);
create function private.chat_usage_immutable()returns trigger language plpgsql set search_path=''as $$begin raise exception 'chat_tariff_is_immutable';end$$;
create trigger chat_usage_version_immutable before update or delete on private.chat_usage_versions for each row execute function private.chat_usage_immutable();
create function private.chat_usage_config(m text)returns jsonb language plpgsql security definer set search_path=''as $$
declare c jsonb;k text;
begin
 select v.tariff||jsonb_build_object('version',v.version)into c from private.chat_usage_settings s join private.chat_usage_versions v on v.version=s.version where s.model=m and s.enabled;
 if c is null or c->>'model'is distinct from m or coalesce(length(c->>'requestModel'),0)not between 1 and 100 or coalesce(length(c->>'evidence'),0)not between 10 and 2000 or jsonb_typeof(c->'responseModels')is distinct from 'array'or jsonb_array_length(c->'responseModels')not between 1 and 10 then raise exception 'chat_tariff_unavailable';end if;
 foreach k in array array['inputPerMillionNano','cachedInputPerMillionNano','outputPerMillionNano']loop if coalesce(c->>k,'')!~'^(0|[1-9][0-9]{0,18})$'then raise exception 'invalid_token_tariff';end if;end loop;
 if (c->>'cachedInputPerMillionNano')::numeric>(c->>'inputPerMillionNano')::numeric or(c->>'inputPerMillionNano')::numeric+(c->>'outputPerMillionNano')::numeric<=0 then raise exception 'invalid_token_tariff';end if;
 if coalesce(c->>'markupBps','')!~'^[0-9]{1,7}$'or(c->>'markupBps')::integer>1000000 or coalesce(c->>'maxInputTokens','')!~'^[0-9]{1,6}$'or(c->>'maxInputTokens')::integer not between 1024 and 256000 or coalesce(c->>'maxOutputTokens','')!~'^[0-9]{1,5}$'or(c->>'maxOutputTokens')::integer not between 1 and 16000 then raise exception 'invalid_token_tariff';end if;
 return c;
end$$;
create function private.chat_usage_cap(c jsonb)returns bigint language sql immutable set search_path=''as $$select ceil(ceil(((c->>'maxInputTokens')::numeric*(c->>'inputPerMillionNano')::numeric+(c->>'maxOutputTokens')::numeric*(c->>'outputPerMillionNano')::numeric)/1000000)*(10000+(c->>'markupBps')::numeric)/100000000000)::bigint$$;
create function private.chat_usage_amount(c jsonb,cap bigint,r jsonb)returns jsonb language plpgsql set search_path=''as $$
declare k text;i bigint;o bigint;cache bigint;cost numeric;capture bigint;
begin
 if jsonb_typeof(r)is distinct from 'object'or coalesce(length(r->>'providerRequestId'),0)not between 1 and 200 or coalesce(r->>'finishReason','')not in('stop','length','cancelled')or not exists(select 1 from jsonb_array_elements_text(c->'responseModels')x where x=r->>'resolvedModel')then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 foreach k in array array['inputTokens','outputTokens','cachedInputTokens','totalTokens']loop if coalesce(r->>k,'')!~'^(0|[1-9][0-9]{0,6})$'then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;end loop;
 i:=(r->>'inputTokens')::bigint;o:=(r->>'outputTokens')::bigint;cache:=(r->>'cachedInputTokens')::bigint;
 if cache>i or i+o<>(r->>'totalTokens')::bigint then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 if i>(c->>'maxInputTokens')::integer or o>(c->>'maxOutputTokens')::integer then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_budget_exceeded');end if;
 cost:=ceil(((i-cache)*(c->>'inputPerMillionNano')::numeric+cache*(c->>'cachedInputPerMillionNano')::numeric+o*(c->>'outputPerMillionNano')::numeric)/1000000);
 capture:=ceil(cost*(10000+(c->>'markupBps')::numeric)/100000000000)::bigint;
 if capture>cap then return jsonb_build_object('pendingMinor',cap,'reviewReason','cost_exceeds_authorized_cap');end if;
 return jsonb_build_object('captureMinor',capture,'releaseMinor',cap-capture,'pendingMinor',0,'costNano',cost::text);
end$$;

-- Single service entry, same account lock and idempotency identity as existing text operations.
create function public.chat_usage_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}')returns jsonb language plpgsql security definer set search_path=''as $$
declare op private.credit_operations%rowtype;u private.chat_usage_operations%rowtype;c jsonb;v text;cap bigint;req uuid:=(p_input->>'requestId')::uuid;h text;v_started jsonb;mid uuid;amount jsonb;capture bigint;release bigint;oid uuid;
begin
 perform 1 from public.account_profiles a join auth.users b on b.id=a.user_id where a.user_id=p_user_id and a.status='active'and b.email_confirmed_at is not null and not b.is_anonymous and b.deleted_at is null and(b.banned_until is null or b.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 if req is null then raise exception 'credit_request_id_required';end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||req for update;
 if p_action='start'then
  if p_input->>'operation'is distinct from 'chat'then raise exception 'invalid_credit_operation';end if;
  h:=md5((p_input-'billing'-'correlationId')::text);
  if op.id is not null then if op.request_hash is distinct from h then raise exception 'idempotency_conflict';end if;return to_jsonb(op);end if;
  c:=private.chat_usage_config(p_input->>'model');cap:=private.chat_usage_cap(c);
  if cap not between 1 and 9007199254740991 then raise exception 'invalid_token_cap';end if;
  select version into v from private.credit_settings where singleton and enabled for share;
  if v is null or p_input#>>'{billing,version}'is distinct from v or p_input#>>'{billing,rateVersion}'is distinct from c->>'version'or p_input#>>'{billing,totalMinor}'is distinct from cap::text then raise exception 'credit_price_changed';end if;
  perform private.credit_wallet(p_user_id);
  update private.credit_wallets set available_minor=available_minor-cap,frozen_minor=frozen_minor+cap where user_id=p_user_id and available_minor>=cap;if not found then raise exception 'insufficient_credits';end if;
  insert into private.credit_operations(user_id,business_key,request_hash,operation,model,version,amount_minor)values(p_user_id,'text:'||req,h,'chat',p_input->>'model',v,cap)returning id into oid;
  insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key)values(p_user_id,oid,'reserve',cap,'reserve:'||oid);
  v_started:=private.start_chat_turn(p_user_id,(p_input#>>'{input,sessionId}')::uuid,p_input#>>'{input,message}');
  update private.credit_operations set started=v_started,session_id=(v_started#>>'{session,id}')::uuid where id=oid returning * into op;
  insert into private.chat_usage_operations(operation_id,tariff)values(op.id,c);return to_jsonb(op);
 end if;
 if op.id is null or op.operation<>'chat'then raise exception 'credit_operation_not_found';end if;
 select * into u from private.chat_usage_operations where operation_id=op.id for update;
 if p_action='complete'then
  if u.operation_id is null then return public.credit_dispatch(p_user_id,'text_complete',p_input);end if;
  if u.settled or op.status in('succeeded','refunded')then return to_jsonb(op);end if;
  if op.result is null or op.status not in('result','needs_review')then raise exception 'credit_result_pending';end if;
  amount:=private.chat_usage_amount(u.tariff,op.amount_minor,u.receipt);
  update private.chat_usage_operations set settlement=amount where operation_id=op.id;
  if (amount->>'pendingMinor')::bigint>0 then
   update private.credit_operations set status='needs_review',updated_at=now()where id=op.id returning * into op;
   insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason)values(p_user_id,op.id,'review',op.amount_minor,'review:'||op.id,amount->>'reviewReason')on conflict do nothing;return to_jsonb(op);
  end if;
  capture:=(amount->>'captureMinor')::bigint;release:=(amount->>'releaseMinor')::bigint;
  if capture<0 or release<0 or capture+release<>op.amount_minor then raise exception 'invalid_token_settlement';end if;
  if exists(select 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active')then mid:=private.complete_chat_turn(p_user_id,op.session_id,op.result->>'content');else mid:=op.id;end if;
  update private.credit_wallets set frozen_minor=frozen_minor-op.amount_minor,available_minor=available_minor+release,spent_minor=spent_minor+capture where user_id=p_user_id and frozen_minor>=op.amount_minor;if not found then raise exception 'token_wallet_invariant';end if;
  if capture>0 then insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason)values(p_user_id,op.id,'capture',capture,'capture:'||op.id,'按已核实输入输出 token 结算');end if;
  if release>0 then insert into private.credit_ledger(user_id,operation_id,kind,amount_minor,business_key,reason)values(p_user_id,op.id,'release',release,'release:'||op.id,'退回 token 预算差额');end if;
  update private.chat_usage_operations set settled=true where operation_id=op.id;
  update private.credit_operations set status='succeeded',result=result||jsonb_build_object('messageId',mid),updated_at=now()where id=op.id returning * into op;return to_jsonb(op);
 end if;raise exception 'invalid_token_action';
end$$;

-- Preserve historical dispatch; publish only approved token tariffs for new chat.
alter function public.credit_dispatch(uuid,text,jsonb)set schema private;
alter function private.credit_dispatch(uuid,text,jsonb)rename to credit_dispatch_before_token;
create function public.credit_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}')returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb;prices jsonb;c jsonb;m text;cap bigint;
begin
 if p_action='text_start'and p_input->>'operation'='chat'then return public.chat_usage_dispatch(p_user_id,'start',p_input);end if;
 r:=private.credit_dispatch_before_token(p_user_id,p_action,p_input);
 if p_action='catalog'then
  select coalesce(jsonb_agg(x),'[]')into prices from jsonb_array_elements(r->'prices')x where x->>'operation'<>'chat';
  for m in select model from private.chat_usage_settings where enabled loop
   c:=private.chat_usage_config(m);cap:=private.chat_usage_cap(c);
   prices:=prices||jsonb_build_array(jsonb_build_object('operation','chat','provider',m,'model',m,'resolution','','unitMinor',cap,'label',m,'billingMode','usage_capped','rateVersion',c->>'version','tokenTariff',jsonb_build_object('inputPerMillionNano',ceil((c->>'inputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'cachedInputPerMillionNano',ceil((c->>'cachedInputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'outputPerMillionNano',ceil((c->>'outputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'maxInputTokens',(c->>'maxInputTokens')::integer,'maxOutputTokens',(c->>'maxOutputTokens')::integer)));
  end loop;return jsonb_set(r,'{prices}',prices);
 end if;return r;
end$$;

-- Protect new operations from any legacy whole-cap completion path.
alter function private.credit_settle(uuid,text,text)rename to credit_settle_before_token;
create function private.credit_settle(p_id uuid,p_status text,p_reason text default null)returns void language plpgsql security definer set search_path=''as $$begin
 if p_status='succeeded'and exists(select 1 from private.chat_usage_operations where operation_id=p_id)then raise exception 'use_token_settlement';end if;
 perform private.credit_settle_before_token(p_id,p_status,p_reason);
end$$;

-- Extend the funded relay rather than creating a public proxy or accepting browser usage.

alter function public.openai_chat_relay(uuid,uuid,text,text,text)set schema private;
alter function private.openai_chat_relay(uuid,uuid,text,text,text)rename to openai_chat_relay_before_token;
create function public.openai_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb;u private.chat_usage_operations%rowtype;op private.credit_operations%rowtype;payload jsonb;
begin
 perform 1 from public.account_profiles a join auth.users b on b.id=a.user_id where a.user_id=p_user_id and a.status='active'and b.email_confirmed_at is not null and not b.is_anonymous and b.deleted_at is null and(b.banned_until is null or b.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||p_request_id for update;
 if op.id is null or op.operation<>'chat'or op.model is distinct from p_model then raise exception 'relay_not_authorized';end if;
 select * into u from private.chat_usage_operations where operation_id=op.id for update;
 if p_action='inspect'then
  if u.operation_id is null then return jsonb_build_object('action','legacy');end if;
  if op.status<>'processing'or not public.assert_chat_provider_available(p_model)or exists(select 1 from private.openai_chat_calls where operation_id=op.id)then return jsonb_build_object('action','claimed');end if;
  perform 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active'for update;if not found then raise exception 'session_not_found';end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'content',x.text)order by x.sequence),'[]')into r from(select role,text,sequence from public.timeline_items where session_id=op.session_id and sequence<=(select sequence from public.timeline_items where id=(op.started->>'userMessageId')::uuid and session_id=op.session_id)and kind='message'and role in('user','assistant')order by sequence desc limit 20)x;
  return jsonb_build_object('action','ready','messages',r,'billingMode','usage_capped','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer);
 end if;
 if p_action='reject_not_started'and u.operation_id is not null then
  if op.status<>'processing'or exists(select 1 from private.openai_chat_calls where operation_id=op.id)then raise exception 'relay_result_pending';end if;
  perform public.credit_dispatch(p_user_id,'text_refund',jsonb_build_object('requestId',p_request_id,'reason','Verified rejection before supplier attempt'));
  return jsonb_build_object('notStarted',true);
 end if;
 if p_action='usage_result'then
  payload:=p_content::jsonb;
  if u.operation_id is null then return private.openai_chat_relay_before_token(p_user_id,p_request_id,p_model,'result',payload->>'content');end if;
  if u.receipt is not null and u.receipt is distinct from payload->'receipt'then raise exception 'idempotency_conflict';end if;
  r:=private.openai_chat_relay_before_token(p_user_id,p_request_id,p_model,'result',payload->>'content');
  update private.chat_usage_operations set receipt=payload->'receipt'where operation_id=op.id;
  return r;
 end if;
 if p_action='result'and u.operation_id is not null then raise exception 'token_receipt_required';end if;
 r:=private.openai_chat_relay_before_token(p_user_id,p_request_id,p_model,p_action,p_content);
 if p_action='claim'and r->>'action'='start'and u.operation_id is not null then return r||jsonb_build_object('billingMode','usage_capped','physicalModel',u.tariff->>'requestModel','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer);end if;
 return r;
end$$;
revoke all on function public.openai_chat_relay(uuid,uuid,text,text,text)from public,anon,authenticated;
grant execute on function public.openai_chat_relay(uuid,uuid,text,text,text)to service_role;

alter function public.doubao_chat_relay(uuid,uuid,text,text,text)set schema private;
alter function private.doubao_chat_relay(uuid,uuid,text,text,text)rename to doubao_chat_relay_before_token;
create function public.doubao_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb;u private.chat_usage_operations%rowtype;op private.credit_operations%rowtype;payload jsonb;
begin
 perform 1 from public.account_profiles a join auth.users b on b.id=a.user_id where a.user_id=p_user_id and a.status='active'and b.email_confirmed_at is not null and not b.is_anonymous and b.deleted_at is null and(b.banned_until is null or b.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||p_request_id for update;
 if op.id is null or op.operation<>'chat'or op.model is distinct from p_model then raise exception 'relay_not_authorized';end if;
 select * into u from private.chat_usage_operations where operation_id=op.id for update;
 if p_action='inspect'then
  if u.operation_id is null then return jsonb_build_object('action','legacy');end if;
  if op.status<>'processing'or not public.assert_chat_provider_available(p_model)or exists(select 1 from private.doubao_chat_calls where operation_id=op.id)then return jsonb_build_object('action','claimed');end if;
  perform 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active'for update;if not found then raise exception 'session_not_found';end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'content',x.text)order by x.sequence),'[]')into r from(select role,text,sequence from public.timeline_items where session_id=op.session_id and sequence<=(select sequence from public.timeline_items where id=(op.started->>'userMessageId')::uuid and session_id=op.session_id)and kind='message'and role in('user','assistant')order by sequence desc limit 20)x;
  return jsonb_build_object('action','ready','messages',r,'billingMode','usage_capped','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer);
 end if;
 if p_action='reject_not_started'and u.operation_id is not null then
  if op.status<>'processing'or exists(select 1 from private.doubao_chat_calls where operation_id=op.id)then raise exception 'relay_result_pending';end if;
  perform public.credit_dispatch(p_user_id,'text_refund',jsonb_build_object('requestId',p_request_id,'reason','Verified rejection before supplier attempt'));
  return jsonb_build_object('notStarted',true);
 end if;
 if p_action='usage_result'then
  payload:=p_content::jsonb;
  if u.operation_id is null then return private.doubao_chat_relay_before_token(p_user_id,p_request_id,p_model,'result',payload->>'content');end if;
  if u.receipt is not null and u.receipt is distinct from payload->'receipt'then raise exception 'idempotency_conflict';end if;
  r:=private.doubao_chat_relay_before_token(p_user_id,p_request_id,p_model,'result',payload->>'content');
  update private.chat_usage_operations set receipt=payload->'receipt'where operation_id=op.id;
  return r;
 end if;
 if p_action='result'and u.operation_id is not null then raise exception 'token_receipt_required';end if;
 r:=private.doubao_chat_relay_before_token(p_user_id,p_request_id,p_model,p_action,p_content);
 if p_action='claim'and r->>'action'='start'and u.operation_id is not null then return r||jsonb_build_object('billingMode','usage_capped','physicalModel',u.tariff->>'requestModel','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer);end if;
 return r;
end$$;
revoke all on function public.doubao_chat_relay(uuid,uuid,text,text,text)from public,anon,authenticated;
grant execute on function public.doubao_chat_relay(uuid,uuid,text,text,text)to service_role;

do $$declare n text;f regprocedure;begin
 foreach n in array array['chat_usage_versions','chat_usage_settings','chat_usage_operations']loop execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'and(p.proname like 'chat_usage_%'or p.proname in('credit_dispatch_before_token','credit_settle','credit_settle_before_token','openai_chat_relay_before_token','doubao_chat_relay_before_token'))loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;
end$$;
revoke all on function public.chat_usage_dispatch(uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.chat_usage_dispatch(uuid,text,jsonb)to service_role;
revoke all on function public.credit_dispatch(uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.credit_dispatch(uuid,text,jsonb)to service_role;

-- Worker removes image bytes after completion. Keep bounded, private usage facts separately.
create table private.image_usage_receipts(generation_id uuid primary key,user_id uuid not null references auth.users(id)on delete cascade,operation_id uuid references private.credit_operations(id)on delete set null,receipt jsonb not null check(pg_column_size(receipt)<=8192),created_at timestamptz not null default now());
alter table private.image_usage_receipts enable row level security;
revoke all on private.image_usage_receipts from public,anon,authenticated,service_role;
create function private.preserve_image_usage_receipt()returns trigger language plpgsql security definer set search_path=''as $$
declare r jsonb;g public.generations%rowtype;opid uuid;
begin
 if new.phase<>'completed'or new.result is not null or old.result->'providerUsage'is null then return new;end if;
 select * into g from public.generations where id=new.generation_id;
 r:=old.result->'providerUsage';
 if g.id is null or r->>'provider'is distinct from g.provider or r->>'requestedModel'is distinct from g.model or r->>'source'is distinct from 'provider_response'or pg_column_size(r)>8192 then return new;end if;
 select id into opid from private.credit_operations where original_generation_id=g.id;
 -- Never preserve prompt, image bytes or arbitrary provider root fields.
 r:=jsonb_strip_nulls(jsonb_build_object('provider',r->'provider','source',r->'source','requestedModel',r->'requestedModel','resolvedModel',r->'resolvedModel','providerRequestId',r->'providerRequestId','size',r->'size','quality',r->'quality','serviceTier',r->'serviceTier','usage',r->'usage','reviewReason',r->'reviewReason'));
 insert into private.image_usage_receipts(generation_id,user_id,operation_id,receipt)values(g.id,(select user_id from public.generation_batches where id=g.batch_id),opid,r)on conflict do nothing;
 return new;
end$$;
revoke all on function private.preserve_image_usage_receipt()from public,anon,authenticated,service_role;
create trigger preserve_image_usage_receipt before update of result on private.generation_work for each row execute function private.preserve_image_usage_receipt();

$zimage_m6_source$;
END
$zimage_m6_atomic$;
