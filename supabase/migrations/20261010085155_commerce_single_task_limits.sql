-- Restore the approved single-task commerce limits without widening raw quotes,
-- per-child model counts, direct generation limits, prices, or daily quotas.
-- Existing runs, jobs, selections and billing records are retained.

alter table public.commerce_run_items
  drop constraint commerce_run_items_position_check,
  add constraint commerce_run_items_position_check check (position between 1 and 32);

-- Only the trusted dispatcher opts into commerce after rebuilding selected
-- image/count=1 rows from the saved task revision via private.credit_items.
create function private.credit_quote(p_items jsonb, p_commerce boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings private.credit_settings%rowtype; prices jsonb; item jsonb; price jsonb; lines jsonb:='[]'; total bigint:=0; amount bigint; quantity integer;
begin
 select * into settings from private.credit_settings where singleton for share;
 if not settings.enabled then raise exception 'credits_disabled'; end if;
 select v.prices into prices from private.credit_price_versions v where v.version=settings.version;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and (case when p_commerce then 32 else 8 end) then raise exception 'invalid_credit_items'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if p_commerce and (item->>'operation' is distinct from 'image') then raise exception 'invalid_credit_items'; end if;
  quantity:=(item->>'count')::integer;
  if quantity is null or quantity not between 1 and 8 or (p_commerce and quantity<>1) then raise exception 'invalid_credit_count'; end if;
  select p into price from jsonb_array_elements(prices) p where p->>'operation'=item->>'operation' and p->>'provider'=item->>'provider' and p->>'model'=item->>'model' and p->>'resolution'=coalesce(item->>'resolution','');
  if price is null then raise exception 'credit_price_unavailable'; end if;
  amount:=(price->>'unitMinor')::bigint*quantity; total:=total+amount;
  lines:=lines||jsonb_build_array(item||jsonb_build_object('unitMinor',(price->>'unitMinor')::bigint,'totalMinor',amount));
 end loop;
 return jsonb_build_object('version',settings.version,'totalMinor',total,'items',lines);
end $$;
-- Preserve the original signature and 8-row/count-8 contract for all legacy
-- callers, including individual generation reserves and text operations.
create or replace function private.credit_quote(p_items jsonb) returns jsonb
language sql security definer set search_path='' as $$
  select private.credit_quote(p_items,false);
$$;

-- Keep all existing admission, idempotency and settlement behavior; the only
-- changes below classify saved commerce quotes and submissions explicitly.
create or replace function public.credit_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif p_action='quote' then return private.credit_quote(case when p_input ? 'action' then private.credit_items(p_user_id,p_input->>'action',p_input->'input') else p_input->'items' end,coalesce(p_input->>'action'='commerce',false));
 end if;
 req:=(p_input->>'requestId')::uuid;
 if req is null then raise exception 'credit_request_id_required'; end if;
 h:=md5(p_action||((p_input-'billing'-'correlationId')::text));
 if p_action in ('image','recreate','commerce') then
  select * into prior from private.credit_requests where user_id=p_user_id and request_id=req;
  if found then if prior.request_hash<>h then raise exception 'idempotency_conflict'; end if; return prior.result; end if;
  q:=private.credit_quote(private.credit_items(p_user_id,p_action,p_input),p_action='commerce'); perform private.credit_check(q,p_input->'billing');
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

-- No client or service-role bypass of trusted saved-task reconstruction.
-- CREATE OR REPLACE retains the public dispatcher's existing service-only ACL.
revoke all on function private.credit_quote(jsonb),private.credit_quote(jsonb,boolean)
  from public,anon,authenticated,service_role;
