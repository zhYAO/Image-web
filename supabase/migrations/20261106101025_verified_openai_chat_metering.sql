-- Local candidate only. Replaces existing functions, preserving owners/ACLs.
-- No enabled flags, prices, secrets, old snapshots or applied migrations changed.
-- OpenAI Chat Completions supports Standard and30m cache writes only in this profile.

create or replace function private.chat_usage_config(m text)returns jsonb language plpgsql security definer set search_path=''as $$
declare c jsonb;k text;
begin
 select v.tariff||jsonb_build_object('version',v.version)into c from private.chat_usage_settings s join private.chat_usage_versions v on v.version=s.version where s.model=m and s.enabled;
 if c is null or c->>'model'is distinct from m or coalesce(length(c->>'requestModel'),0)not between 1 and 100 or coalesce(length(c->>'evidence'),0)not between 10 and 2000 or jsonb_typeof(c->'responseModels')is distinct from 'array'or jsonb_array_length(c->'responseModels')not between 1 and 10 then raise exception 'chat_tariff_unavailable';end if;
 foreach k in array array['inputPerMillionNano','cachedInputPerMillionNano','outputPerMillionNano']loop if coalesce(c->>k,'')!~'^(0|[1-9][0-9]{0,18})$'then raise exception 'invalid_token_tariff';end if;end loop;
 if (c->>'cachedInputPerMillionNano')::numeric>(c->>'inputPerMillionNano')::numeric or(c->>'inputPerMillionNano')::numeric+(c->>'outputPerMillionNano')::numeric<=0 then raise exception 'invalid_token_tariff';end if;
 if coalesce(c->>'markupBps','')!~'^[0-9]{1,7}$'or(c->>'markupBps')::integer>1000000 or coalesce(c->>'maxInputTokens','')!~'^[0-9]{1,6}$'or(c->>'maxInputTokens')::integer not between 1024 and 256000 or coalesce(c->>'maxOutputTokens','')!~'^[0-9]{1,5}$'or(c->>'maxOutputTokens')::integer not between 1 and 16000 then raise exception 'invalid_token_tariff';end if;
 if m in('gpt-6-astra','gpt-6.1-sol')and c->>'meteringVersion'is distinct from '2'then raise exception 'invalid_metering_profile';end if;
 if m='doubao'and c->>'meteringVersion'is distinct from '3'then raise exception 'invalid_metering_profile';end if;
 if c ?| array['meteringVersion','serviceTier','cacheTtl','cacheWritePerMillionNano']then
  if c->>'meteringVersion'='3'and m='doubao'then
   if jsonb_typeof(c->'meteringVersion')is distinct from 'number'or c->>'serviceTier'is distinct from 'default'or c ?| array['cacheTtl','cacheWritePerMillionNano']then raise exception 'invalid_metering_profile';end if;
  else
  if jsonb_typeof(c->'meteringVersion')is distinct from 'number'or c->>'meteringVersion'is distinct from '2'or c->>'serviceTier'is distinct from 'default'or c->>'cacheTtl'is distinct from '30m'or coalesce(c->>'cacheWritePerMillionNano','')!~'^(0|[1-9][0-9]{0,18})$'then raise exception 'invalid_metering_profile';end if;
  if(c->>'cacheWritePerMillionNano')::numeric<(c->>'inputPerMillionNano')::numeric then raise exception 'invalid_metering_profile';end if;
  end if;
 end if;
 return c;
end$$;

create or replace function private.chat_usage_cap(c jsonb)returns bigint language sql immutable set search_path=''as $$select ceil(ceil(((c->>'maxInputTokens')::numeric*coalesce(c->>'cacheWritePerMillionNano',c->>'inputPerMillionNano')::numeric+(c->>'maxOutputTokens')::numeric*(c->>'outputPerMillionNano')::numeric)/1000000)*(10000+(c->>'markupBps')::numeric)/100000000000)::bigint$$;
create or replace function private.chat_usage_amount(c jsonb,cap bigint,r jsonb)returns jsonb language plpgsql set search_path=''as $$
declare k text;i bigint;o bigint;cache bigint;w bigint:=0;cost numeric;capture bigint;
begin
 if jsonb_typeof(r)is distinct from 'object'or coalesce(length(r->>'providerRequestId'),0)not between 1 and 200 or coalesce(r->>'finishReason','')not in('stop','length','cancelled')or not exists(select 1 from jsonb_array_elements_text(c->'responseModels')x where x=r->>'resolvedModel')then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 foreach k in array array['inputTokens','outputTokens','cachedInputTokens','totalTokens']loop if coalesce(r->>k,'')!~'^(0|[1-9][0-9]{0,6})$'then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;end loop;
 i:=(r->>'inputTokens')::bigint;o:=(r->>'outputTokens')::bigint;cache:=(r->>'cachedInputTokens')::bigint;
 if cache>i or i+o<>(r->>'totalTokens')::bigint then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 if c->>'meteringVersion'='3'and(jsonb_typeof(r->'meteringVersion')is distinct from 'number'or r->>'meteringVersion'is distinct from '3'or r->>'serviceTier'is distinct from c->>'serviceTier')then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 if c->>'meteringVersion'='2'then
  if jsonb_typeof(r->'meteringVersion')is distinct from 'number'or r->>'meteringVersion'is distinct from '2'or r->>'serviceTier'is distinct from c->>'serviceTier'or r->>'cacheTtl'is distinct from c->>'cacheTtl'or coalesce(r->>'cacheWriteTokens','')!~'^(0|[1-9][0-9]{0,6})$'then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
  w:=(r->>'cacheWriteTokens')::bigint;
  if cache+w>i then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_unverified');end if;
 end if;
 if i>(c->>'maxInputTokens')::integer or o>(c->>'maxOutputTokens')::integer then return jsonb_build_object('pendingMinor',cap,'reviewReason','usage_budget_exceeded');end if;
 cost:=ceil(((i-cache-w)*(c->>'inputPerMillionNano')::numeric+w*coalesce((c->>'cacheWritePerMillionNano')::numeric,0)+cache*(c->>'cachedInputPerMillionNano')::numeric+o*(c->>'outputPerMillionNano')::numeric)/1000000);
 capture:=ceil(cost*(10000+(c->>'markupBps')::numeric)/100000000000)::bigint;
 if capture>cap then return jsonb_build_object('pendingMinor',cap,'reviewReason','cost_exceeds_authorized_cap');end if;
 return jsonb_build_object('captureMinor',capture,'releaseMinor',cap-capture,'pendingMinor',0,'costNano',cost::text);
end$$;

create or replace function public.openai_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
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
  return jsonb_build_object('action','ready','messages',r,'physicalModel',u.tariff->>'requestModel','billingMode','usage_capped','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer,'meteringVersion',u.tariff->'meteringVersion','serviceTier',u.tariff->'serviceTier','cacheTtl',u.tariff->'cacheTtl');
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
 if p_action='claim'and r->>'action'='start'and u.operation_id is not null then return r||jsonb_build_object('billingMode','usage_capped','physicalModel',u.tariff->>'requestModel','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer,'meteringVersion',u.tariff->'meteringVersion','serviceTier',u.tariff->'serviceTier','cacheTtl',u.tariff->'cacheTtl');end if;
 return r;
end$$;

create or replace function public.credit_dispatch(p_user_id uuid,p_action text,p_input jsonb default '{}')returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb;prices jsonb;c jsonb;m text;cap bigint;
begin
 if p_action='text_start'and p_input->>'operation'='chat'then return public.chat_usage_dispatch(p_user_id,'start',p_input);end if;
 r:=private.credit_dispatch_before_token(p_user_id,p_action,p_input);
 if p_action='catalog'then
  select coalesce(jsonb_agg(x),'[]')into prices from jsonb_array_elements(r->'prices')x where x->>'operation'<>'chat';
  for m in select model from private.chat_usage_settings where enabled loop
   c:=private.chat_usage_config(m);cap:=private.chat_usage_cap(c);
   prices:=prices||jsonb_build_array(jsonb_build_object('operation','chat','provider',m,'model',m,'resolution','','unitMinor',cap,'label',m,'billingMode','usage_capped','rateVersion',c->>'version','tokenTariff',jsonb_strip_nulls(jsonb_build_object('inputPerMillionNano',ceil((c->>'inputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'cachedInputPerMillionNano',ceil((c->>'cachedInputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'outputPerMillionNano',ceil((c->>'outputPerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text,'cacheWritePerMillionNano',case when c->>'meteringVersion'='2'then ceil((c->>'cacheWritePerMillionNano')::numeric*(10000+(c->>'markupBps')::numeric)/10000)::text else null end,'serviceTier',c->'serviceTier','cacheTtl',c->'cacheTtl','maxInputTokens',(c->>'maxInputTokens')::integer,'maxOutputTokens',(c->>'maxOutputTokens')::integer))));
  end loop;return jsonb_set(r,'{prices}',prices);
 end if;return r;
end$$;

create or replace function public.doubao_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
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
  return jsonb_build_object('action','ready','messages',r,'physicalModel',u.tariff->>'requestModel','billingMode','usage_capped','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer,'meteringVersion',u.tariff->'meteringVersion','serviceTier',u.tariff->'serviceTier');
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
 if p_action='claim'and r->>'action'='start'and u.operation_id is not null then return r||jsonb_build_object('billingMode','usage_capped','physicalModel',u.tariff->>'requestModel','maxInputTokens',(u.tariff->>'maxInputTokens')::integer,'maxOutputTokens',(u.tariff->>'maxOutputTokens')::integer,'meteringVersion',u.tariff->'meteringVersion','serviceTier',u.tariff->'serviceTier');end if;
 return r;
end$$;
