-- Operational diagnostics only. Empty by default; no wallet, tariff, provider flag or campaign activation DML.
create table private.provider_diagnostic_campaigns (
 id uuid primary key,
 approval_ref text not null check (length(approval_ref) between 12 and 256),
 approved_at timestamptz not null,
 expires_at timestamptz not null check (expires_at > approved_at and expires_at <= approved_at + interval '15 minutes'),
 state text not null default 'disabled' check (state in ('disabled','armed','halted','complete')),
 created_at timestamptz not null default clock_timestamp()
);
create table private.provider_diagnostic_attempts (
 campaign_id uuid not null references private.provider_diagnostic_campaigns(id),
 slot text not null check (slot in ('astra','sol')),
 state text not null check (state in ('claimed','verified','needs_review')),
 claimed_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 receipt jsonb,
 reason text check (reason in ('profile_mismatch','provider_evidence_unverified','invalid_receipt')),
 estimated_usd_micros bigint check (estimated_usd_micros between 0 and 32000),
 primary key(campaign_id,slot)
);
alter table private.provider_diagnostic_campaigns enable row level security;
alter table private.provider_diagnostic_attempts enable row level security;
revoke all on private.provider_diagnostic_campaigns,private.provider_diagnostic_attempts from public,anon,authenticated,service_role;

create function public.provider_diagnostic(p_campaign_id uuid,p_slot text,p_action text,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c private.provider_diagnostic_campaigns%rowtype;
 a private.provider_diagnostic_attempts%rowtype;
 model text; r jsonb; valid boolean:=true; k text; input_n bigint; output_n bigint; cached_n bigint; write_n bigint; total_n bigint; cost_n bigint;
begin
 if p_campaign_id is null or p_slot is null or p_slot not in ('astra','sol') or p_action is null or p_action not in ('claim','status','record') then raise exception 'invalid_diagnostic_request';end if;
 model:=case p_slot when 'astra' then 'gpt-6-astra' else 'gpt-6.1-sol' end;
 select * into c from private.provider_diagnostic_campaigns where id=p_campaign_id for update;
 if not found then raise exception 'diagnostic_not_approved';end if;
 select * into a from private.provider_diagnostic_attempts where campaign_id=p_campaign_id and slot=p_slot;
 if p_action='claim' and a.campaign_id is null then
  if c.state<>'armed' or c.approved_at>clock_timestamp() or c.expires_at<=clock_timestamp() then raise exception 'diagnostic_not_approved';end if;
  if p_slot='sol' and not exists(select 1 from private.provider_diagnostic_attempts where campaign_id=p_campaign_id and slot='astra' and state='verified') then raise exception 'diagnostic_not_ready';end if;
  insert into private.provider_diagnostic_attempts(campaign_id,slot,state)values(p_campaign_id,p_slot,'claimed');
  return jsonb_build_object('action','start','profile','openai-small-v1','model',model,'maxInputTokens',2048,'maxOutputTokens',128,'requestSha256',case p_slot when 'astra' then 'bafa4ab06078ae70ebb49b4ef69720900aee254bf41e16402cab3114f41568ef' else 'f3fc239e3c8ebbd11da567e991db1dfb8e0308a38d5d7e421562ed79662fa478' end);
 end if;
 if p_action='record' then
  if a.campaign_id is null then raise exception 'diagnostic_not_started';end if;
  if a.state<>'claimed' then
   if not(a.state='verified' and p_result=jsonb_build_object('outcome','verified','receipt',a.receipt)) and not(a.state='needs_review' and p_result=jsonb_build_object('outcome','uncertain','reason',a.reason)) then raise exception 'diagnostic_terminal_conflict';end if;
  else
   r:=p_result->'receipt';
   valid:=coalesce(jsonb_typeof(p_result)='object' and p_result->>'outcome'='verified' and jsonb_typeof(r)='object',false);
   if valid then
    -- Explicit cardinality also rejects missing and extra metadata.
    valid:=(select count(*)=10 and bool_and(key in ('providerRequestId','resolvedModel','serviceTier','requestedCacheTtl','inputTokens','outputTokens','totalTokens','cachedInputTokens','cacheWriteTokens','finishReason'))from jsonb_object_keys(r)key)
     and (select count(*)=2 and bool_and(key in ('outcome','receipt'))from jsonb_object_keys(p_result)key);
    valid:=valid and jsonb_typeof(r->'providerRequestId')='string' and (r->>'providerRequestId')~'^[a-zA-Z0-9_.:-]{1,200}$' and r->>'resolvedModel'=model and r->>'serviceTier'='default' and r->>'requestedCacheTtl'='30m' and r->>'finishReason' in ('stop','length');
    foreach k in array array['inputTokens','outputTokens','totalTokens','cachedInputTokens','cacheWriteTokens'] loop
     if coalesce(jsonb_typeof(r->k)<>'number' or (r->>k)!~'^(0|[1-9][0-9]{0,6})$',true) then valid:=false;end if;
    end loop;
   end if;
   if coalesce(valid,false) then
    input_n:=(r->>'inputTokens')::bigint;output_n:=(r->>'outputTokens')::bigint;cached_n:=(r->>'cachedInputTokens')::bigint;write_n:=(r->>'cacheWriteTokens')::bigint;total_n:=(r->>'totalTokens')::bigint;
    valid:=input_n<=2048 and output_n<=128 and cached_n+write_n<=input_n and total_n=input_n+output_n;
   end if;
   if coalesce(valid,false) then
    cost_n:=ceil(case p_slot when 'astra' then (input_n-cached_n-write_n)*10+cached_n+write_n*12.5+output_n*50 else (input_n-cached_n-write_n)*2+cached_n*0.1+write_n*2.5+output_n*10 end);
    update private.provider_diagnostic_attempts set state='verified',finished_at=clock_timestamp(),receipt=r,estimated_usd_micros=cost_n where campaign_id=p_campaign_id and slot=p_slot;
    if p_slot='sol' then update private.provider_diagnostic_campaigns set state='complete' where id=p_campaign_id;end if;
   else
    update private.provider_diagnostic_attempts set state='needs_review',finished_at=clock_timestamp(),reason=case when p_result=jsonb_build_object('outcome','uncertain','reason','profile_mismatch')then 'profile_mismatch' when p_result=jsonb_build_object('outcome','uncertain','reason','provider_evidence_unverified')then 'provider_evidence_unverified' else 'invalid_receipt' end where campaign_id=p_campaign_id and slot=p_slot;
    update private.provider_diagnostic_campaigns set state='halted' where id=p_campaign_id;
   end if;
  end if;
 end if;
 select * into c from private.provider_diagnostic_campaigns where id=p_campaign_id;
 select * into a from private.provider_diagnostic_attempts where campaign_id=p_campaign_id and slot=p_slot;
 return jsonb_build_object('action','status','campaignId',p_campaign_id,'slot',p_slot,'state',c.state,'attemptState',coalesce(a.state,'not_started'),'receipt',a.receipt,'estimatedUsdMicros',a.estimated_usd_micros);
end $$;
revoke all on function public.provider_diagnostic(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.provider_diagnostic(uuid,text,text,jsonb) to service_role;
