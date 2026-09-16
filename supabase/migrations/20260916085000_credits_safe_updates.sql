-- Supabase PostgREST enforces safe updates. Scope operator changes to the
-- singleton row instead of disabling the guard or rewriting a deployed migration.
create or replace function public.credit_admin(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 elsif p_input->>'action'='activate' then update private.credit_settings set enabled=(p_input->>'enabled')::boolean where singleton=true;
 elsif p_input->>'action'='price' then
  if coalesce(length(p_input->>'version'),0) not between 1 and 100 then raise exception 'invalid_credit_version'; end if;
  if jsonb_typeof(p_input->'prices') is distinct from 'array' or jsonb_array_length(p_input->'prices')<>7 then raise exception 'invalid_credit_prices'; end if;
  for item in select value from jsonb_array_elements(p_input->'prices') loop
   if jsonb_typeof(item->'label') is distinct from 'string' or coalesce(length(item->>'label'),0) not between 1 and 100 or item->>'unitMinor' is null or jsonb_typeof(item->'unitMinor') is distinct from 'number' or (item->>'unitMinor') !~ '^[0-9]+$' or (item->>'unitMinor')::bigint not between 1 and 1000000 or not exists(select 1 from private.credit_price_versions v,jsonb_array_elements(v.prices) p where v.version='2026-09-15.1' and (p-'unitMinor'-'label')=(item-'unitMinor'-'label')) then raise exception 'invalid_credit_prices'; end if;
  end loop;
  if (select count(distinct (p-'unitMinor'-'label')) from jsonb_array_elements(p_input->'prices') p)<>7 then raise exception 'invalid_credit_prices'; end if;
  insert into private.credit_price_versions(version,prices) values(p_input->>'version',p_input->'prices');update private.credit_settings set version=p_input->>'version' where singleton=true;
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

