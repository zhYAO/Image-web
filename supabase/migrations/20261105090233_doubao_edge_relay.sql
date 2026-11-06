-- Local candidate; never exports a provider secret.
create table private.doubao_chat_calls(operation_id uuid primary key references private.credit_operations(id) on delete cascade,status text not null check(status in ('claimed','result')),messages jsonb not null,created_at timestamptz not null default now());
alter table private.doubao_chat_calls enable row level security;
revoke all on private.doubao_chat_calls from public,anon,authenticated,service_role;
create function public.doubao_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare op private.credit_operations%rowtype;c private.doubao_chat_calls%rowtype;messages jsonb;
begin
 perform 1 from public.account_profiles a join auth.users u on u.id=a.user_id where a.user_id=p_user_id and a.status='active'and u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||p_request_id for update;
 if not found or op.operation<>'chat'or op.model is distinct from p_model or p_model<>'doubao'then raise exception 'relay_not_authorized';end if;
 if p_action='reject_not_started'then
  if op.status<>'processing'or exists(select 1 from private.doubao_chat_calls where operation_id=op.id)then raise exception 'relay_result_pending';end if;
  perform public.credit_dispatch(p_user_id,'text_refund',jsonb_build_object('requestId',p_request_id,'reason','Edge configuration rejected before supplier attempt'));
  return jsonb_build_object('notStarted',true);
 end if;
 if p_action='claim'then
  if op.result is not null and op.status in('result','succeeded','needs_review')then return jsonb_build_object('action','replay','content',op.result->>'content');end if;
  if op.status<>'processing'or not public.assert_chat_provider_available(p_model)or not exists(select 1 from private.credit_ledger where operation_id=op.id and kind='reserve'and amount_minor=op.amount_minor)then raise exception 'relay_not_authorized';end if;
  perform 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active'for update;if not found then raise exception 'session_not_found';end if;
  if exists(select 1 from private.doubao_chat_calls where operation_id=op.id)then raise exception 'relay_result_pending';end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'content',x.text)order by x.sequence),'[]')into messages from(select role,text,sequence from public.timeline_items where session_id=op.session_id and sequence<=(select sequence from public.timeline_items where id=(op.started->>'userMessageId')::uuid and session_id=op.session_id)and kind='message'and role in('user','assistant')order by sequence desc limit 20)x;
  if jsonb_array_length(messages)=0 then raise exception 'relay_history_missing';end if;
  insert into private.doubao_chat_calls values(op.id,'claimed',messages,now());
  return jsonb_build_object('action','start','model',op.model,'messages',messages);
 elsif p_action='result'then
  select * into c from private.doubao_chat_calls where operation_id=op.id for update;
  if not found or length(coalesce(p_content,''))not between 1 and 64000 then raise exception 'relay_result_invalid';end if;
  if c.status='result'then if op.result->>'content'is distinct from p_content then raise exception 'idempotency_conflict';end if;return jsonb_build_object('saved',true);end if;
  if op.status not in('processing','needs_review')then raise exception 'relay_result_pending';end if;
  perform public.credit_dispatch(p_user_id,'text_result',jsonb_build_object('requestId',p_request_id,'result',jsonb_build_object('content',p_content)));
  update private.doubao_chat_calls set status='result',messages='[]'where operation_id=op.id;
  return jsonb_build_object('saved',true);
 end if;raise exception 'invalid_relay_action';
end $$;
revoke all on function public.doubao_chat_relay(uuid,uuid,text,text,text)from public,anon,authenticated;
grant execute on function public.doubao_chat_relay(uuid,uuid,text,text,text)to service_role;

create function private.clear_doubao_chat_history()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if TG_OP='DELETE'or new.status<>'active'then update private.doubao_chat_calls c set messages='[]'from private.credit_operations o where c.operation_id=o.id and o.session_id=old.id;end if;
 if TG_OP='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.clear_doubao_chat_history()from public,anon,authenticated,service_role;
create trigger doubao_chat_history_closed after update of status on public.sessions for each row execute function private.clear_doubao_chat_history();
create trigger doubao_chat_history_deleted before delete on public.sessions for each row execute function private.clear_doubao_chat_history();

-- Local only. No supplier key is stored in tables or returned to Web.
create table private.doubao_stage_calls(
 operation_id uuid not null references private.credit_operations(id)on delete cascade,
 stage text not null check(stage in('analysis','planning','optimize')),claim_id text not null,
 payload_hash text not null,status text not null check(status in('claimed','result')),
 receipt jsonb,created_at timestamptz not null default now(),primary key(operation_id,stage));
alter table private.doubao_stage_calls enable row level security;
revoke all on private.doubao_stage_calls from public,anon,authenticated,service_role;

create function public.doubao_text_relay(p_user_id uuid,p_request_id uuid,p_operation text,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.credit_operations%rowtype;c private.doubao_stage_calls%rowtype;o record;q record;
 st jsonb;refs jsonb:='[]';claim text;model text;budget integer;item jsonb;sid uuid;
begin
 perform 1 from public.account_profiles a join auth.users u on u.id=a.user_id where a.user_id=p_user_id and a.status='active'and u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 if p_operation='optimize'then
  select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||p_request_id for update;
  if not found or op.operation<>'optimize'or op.model<>'doubao'then raise exception 'relay_not_authorized';end if;
  claim:=p_request_id::text;
  model:=null;budget:=8000;
 else
  if p_operation not in('analysis','planning')then raise exception 'relay_not_authorized';end if;
  -- These tables are introduced by the package migration later in this local candidate.
  select * into o from private.commerce_package_orders where user_id=p_user_id and id=p_request_id for update;
  if not found then raise exception 'relay_not_authorized';end if;
  select * into op from private.credit_operations where id=o.operation_id for update;
  select * into q from private.commerce_package_quotes where id=o.quote_id;
  select j into st from jsonb_array_elements(o.state->'stages')j where j->>'key'=p_operation;
  claim:=p_payload->>'claimId';sid:=o.session_id;
  if claim is null or st->>'claimId'is distinct from claim then raise exception 'relay_not_authorized';end if;
  model:=o.state#>>array['quote','costs',case when p_operation='analysis'then 'visionModel'else 'plannerModel'end];
  budget:=(o.state#>>array['quote','costs',case when p_operation='analysis'then 'visionMaxOutputTokens'else 'plannerMaxOutputTokens'end])::integer;
  if p_operation='analysis'then refs:=q.reference_binding;end if;
 end if;
 select * into c from private.doubao_stage_calls where operation_id=op.id and stage=p_operation for update;
 if p_action='reject_not_started'then
  if p_operation<>'optimize'or c.operation_id is not null or op.status<>'processing'then raise exception 'relay_result_pending';end if;
  item:=jsonb_build_object('requestId',p_request_id,'operation','optimize','model','doubao','input',p_payload->'input');
  if op.request_hash is distinct from md5(item::text)then raise exception 'idempotency_conflict';end if;
  perform public.credit_dispatch(p_user_id,'text_refund',jsonb_build_object('requestId',p_request_id,'reason','Edge configuration rejected before supplier attempt'));
  return jsonb_build_object('notStarted',true);
 end if;
 if p_action='read'then
  if c.operation_id is null or c.claim_id is distinct from claim or c.status<>'result'or c.receipt is null then raise exception 'relay_result_pending';end if;
  -- Existing content remains recoverable without restarting a disabled supplier.
  return jsonb_build_object('action','replay','receipt',c.receipt);
 end if;
 if p_action='result'then
  if c.operation_id is null or c.claim_id is distinct from claim or c.payload_hash is distinct from p_payload->>'payloadHash'
   or jsonb_typeof(p_payload->'receipt')is distinct from 'object'or length(coalesce(p_payload#>>'{receipt,text}',''))not between 1 and 40000 then raise exception 'relay_result_invalid';end if;
  if c.status='result'then
   if c.receipt is distinct from p_payload->'receipt'then raise exception 'idempotency_conflict';end if;return jsonb_build_object('saved',true);
  end if;
  -- No automatic charge/capture; the existing validator and settlement own that decision.
  if op.status not in('processing','needs_review','reserved')then raise exception 'relay_result_pending';end if;
  if sid is not null and not exists(select 1 from public.sessions where id=sid and user_id=p_user_id and status='active')then raise exception 'session_not_found';end if;
  update private.doubao_stage_calls set status='result',receipt=p_payload->'receipt'where operation_id=op.id and stage=p_operation;
  return jsonb_build_object('saved',true);
 end if;
 if p_action not in('claim','inspect')then raise exception 'invalid_relay_action';end if;
 if c.operation_id is not null then
  if c.claim_id is distinct from claim or c.payload_hash is distinct from p_payload->>'payloadHash'then raise exception 'idempotency_conflict';end if;
  if c.status='result'then return jsonb_build_object('action','replay','receipt',c.receipt);end if;raise exception 'relay_result_pending';
 end if;
 if coalesce(p_payload->>'payloadHash','')!~'^[a-f0-9]{64}$'or not exists(select 1 from private.credit_ledger where operation_id=op.id and kind='reserve'and amount_minor=op.amount_minor)then raise exception 'relay_not_authorized';end if;
 if p_operation='optimize'then
  if op.status<>'processing'or not public.assert_chat_provider_available('doubao')then raise exception 'relay_not_authorized';end if;
  item:=jsonb_build_object('requestId',p_request_id,'operation','optimize','model','doubao','input',p_payload->'input');
  if op.request_hash is distinct from md5(item::text)then raise exception 'idempotency_conflict';end if;
 else
  perform 1 from public.sessions where id=sid and user_id=p_user_id and status='active'for update;if not found then raise exception 'session_not_found';end if;
  if o.settled or o.state->>'status'<>'active'or st->>'status'<>'processing'or op.status<>'reserved'then raise exception 'relay_not_authorized';end if;
  if private.commerce_package_config()is null then raise exception 'package_configuration_missing';end if;
  if p_operation='planning'and(o.state->'review'is null or not exists(select 1 from jsonb_array_elements(o.state->'stages')j where j->>'key'='analysis'and j->>'status'='succeeded'))then raise exception 'facts_confirmation_required';end if;
  if p_operation='analysis'and p_payload->'references'is distinct from refs then raise exception 'reference_forbidden';end if;
  if exists(select 1 from jsonb_array_elements(q.reference_binding)j where not exists(select 1 from public.reference_uploads u where u.id=(j->>'id')::uuid and u.user_id=p_user_id and u.session_id=sid and u.status='active'and u.write_state='ready'and u.upload_expires_at>clock_timestamp()and u.storage_bucket='uploads'and starts_with(u.storage_path,p_user_id::text||'/'||sid::text||'/references/')))then raise exception 'reference_expired_or_forbidden';end if;
 end if;
 if p_action='inspect'then return jsonb_build_object('action','ready','model',model,'maxOutputTokens',budget,'references',refs);end if;
 insert into private.doubao_stage_calls values(op.id,p_operation,claim,p_payload->>'payloadHash','claimed',null,now());
 return jsonb_build_object('action','start','model',model,'maxOutputTokens',budget,'references',refs);
end $$;
revoke all on function public.doubao_text_relay(uuid,uuid,text,text,jsonb)from public,anon,authenticated;
grant execute on function public.doubao_text_relay(uuid,uuid,text,text,jsonb)to service_role;

create function private.clear_doubao_stage_content()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if TG_OP='DELETE'or new.status<>'active'then update private.doubao_stage_calls c set receipt=null from private.credit_operations o where c.operation_id=o.id and o.session_id=old.id;end if;
 if TG_OP='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.clear_doubao_stage_content()from public,anon,authenticated,service_role;
create trigger doubao_stage_content_closed after update of status on public.sessions for each row execute function private.clear_doubao_stage_content();
create trigger doubao_stage_content_deleted before delete on public.sessions for each row execute function private.clear_doubao_stage_content();

-- Optimization has no business session. Remove duplicate raw prose after the existing
-- validated result is durable or the credit operation is definitively refunded.
create function private.clear_doubao_optimized_receipt()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.operation='optimize'and(new.status='refunded'or(new.status in('result','succeeded')and new.result is not null))then
  update private.doubao_stage_calls set receipt=null where operation_id=new.id and stage='optimize';
 end if;return new;
end $$;
revoke all on function private.clear_doubao_optimized_receipt()from public,anon,authenticated,service_role;
create trigger doubao_optimized_receipt_terminal after update of status,result on private.credit_operations for each row execute function private.clear_doubao_optimized_receipt();
