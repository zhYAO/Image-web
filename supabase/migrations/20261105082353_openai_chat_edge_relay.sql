create or replace function private.start_chat_turn(p_user_id uuid, p_session_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created boolean := false;
  user_message_id uuid;
  target_session public.sessions%rowtype;
begin
  if p_user_id is null or char_length(btrim(p_message)) not between 1 and 16000 then
    raise exception using errcode = '22023', message = 'invalid_chat_request';
  end if;

  if p_session_id is null then
    insert into public.sessions (user_id, title)
    values (p_user_id, left(btrim(p_message), 100))
    returning * into target_session;
    created := true;
  else
    select * into target_session
    from public.sessions
    where id = p_session_id and user_id = p_user_id and status = 'active'
    for update;
    if target_session.id is null then
      raise exception using errcode = '42501', message = 'session_not_found';
    end if;
  end if;

  insert into public.timeline_items (session_id, kind, role, text)
  values (target_session.id, 'message', 'user', btrim(p_message))returning id into user_message_id;
  update public.sessions set updated_at = timezone('utc', now()) where id = target_session.id
  returning * into target_session;

  return jsonb_build_object(
    'userMessageId',user_message_id,
    'created', created,
    'session', jsonb_build_object(
      'createdAt', target_session.created_at,
      'id', target_session.id,
      'status', target_session.status,
      'title', target_session.title,
      'updatedAt', target_session.updated_at
    )
  );
end;
$$;

-- Local candidate; never exports a provider secret.
create table private.openai_chat_calls(operation_id uuid primary key references private.credit_operations(id) on delete cascade,status text not null check(status in ('claimed','result')),messages jsonb not null,created_at timestamptz not null default now());
alter table private.openai_chat_calls enable row level security;
revoke all on private.openai_chat_calls from public,anon,authenticated,service_role;
create function public.openai_chat_relay(p_user_id uuid,p_request_id uuid,p_model text,p_action text,p_content text default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare op private.credit_operations%rowtype;c private.openai_chat_calls%rowtype;messages jsonb;
begin
 perform 1 from public.account_profiles a join auth.users u on u.id=a.user_id where a.user_id=p_user_id and a.status='active'and u.email_confirmed_at is not null and not u.is_anonymous and u.deleted_at is null and(u.banned_until is null or u.banned_until<=now())for update of a;
 if not found then raise exception 'unauthorized';end if;
 select * into op from private.credit_operations where user_id=p_user_id and business_key='text:'||p_request_id for update;
 if not found or op.operation<>'chat'or op.model is distinct from p_model or p_model not in('gpt-6-astra','gpt-6.1-sol')then raise exception 'relay_not_authorized';end if;
 if p_action='claim'then
  if op.result is not null and op.status in('result','succeeded','needs_review')then return jsonb_build_object('action','replay','content',op.result->>'content');end if;
  if op.status<>'processing'or not public.assert_chat_provider_available(p_model)or not exists(select 1 from private.credit_ledger where operation_id=op.id and kind='reserve'and amount_minor=op.amount_minor)then raise exception 'relay_not_authorized';end if;
  perform 1 from public.sessions where id=op.session_id and user_id=p_user_id and status='active'for update;if not found then raise exception 'session_not_found';end if;
  if exists(select 1 from private.openai_chat_calls where operation_id=op.id)then raise exception 'relay_result_pending';end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'content',x.text)order by x.sequence),'[]')into messages from(select role,text,sequence from public.timeline_items where session_id=op.session_id and sequence<=(select sequence from public.timeline_items where id=(op.started->>'userMessageId')::uuid and session_id=op.session_id)and kind='message'and role in('user','assistant')order by sequence desc limit 20)x;
  if jsonb_array_length(messages)=0 then raise exception 'relay_history_missing';end if;
  insert into private.openai_chat_calls values(op.id,'claimed',messages,now());
  return jsonb_build_object('action','start','model',op.model,'messages',messages);
 elsif p_action='result'then
  select * into c from private.openai_chat_calls where operation_id=op.id for update;
  if not found or length(coalesce(p_content,''))not between 1 and 64000 then raise exception 'relay_result_invalid';end if;
  if c.status='result'then if op.result->>'content'is distinct from p_content then raise exception 'idempotency_conflict';end if;return jsonb_build_object('saved',true);end if;
  if op.status not in('processing','needs_review')then raise exception 'relay_result_pending';end if;
  perform public.credit_dispatch(p_user_id,'text_result',jsonb_build_object('requestId',p_request_id,'result',jsonb_build_object('content',p_content)));
  update private.openai_chat_calls set status='result',messages='[]'where operation_id=op.id;
  return jsonb_build_object('saved',true);
 end if;raise exception 'invalid_relay_action';
end $$;
revoke all on function public.openai_chat_relay(uuid,uuid,text,text,text)from public,anon,authenticated;
grant execute on function public.openai_chat_relay(uuid,uuid,text,text,text)to service_role;

create function private.clear_openai_chat_history()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if TG_OP='DELETE'or new.status<>'active'then update private.openai_chat_calls c set messages='[]'from private.credit_operations o where c.operation_id=o.id and o.session_id=old.id;end if;
 if TG_OP='DELETE'then return old;end if;return new;
end $$;
revoke all on function private.clear_openai_chat_history()from public,anon,authenticated,service_role;
create trigger openai_chat_history_closed after update of status on public.sessions for each row execute function private.clear_openai_chat_history();
create trigger openai_chat_history_deleted before delete on public.sessions for each row execute function private.clear_openai_chat_history();
