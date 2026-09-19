create schema if not exists langgraph;
revoke all on schema langgraph from public, anon, authenticated;
grant usage on schema langgraph to service_role;

create function private.start_chat_turn(p_user_id uuid, p_session_id uuid, p_message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created boolean := false;
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
  values (target_session.id, 'message', 'user', btrim(p_message));
  update public.sessions set updated_at = timezone('utc', now()) where id = target_session.id
  returning * into target_session;

  return jsonb_build_object(
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

create function private.complete_chat_turn(p_user_id uuid, p_session_id uuid, p_content text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_id uuid;
begin
  if char_length(p_content) not between 1 and 64000 then
    raise exception using errcode = '22023', message = 'invalid_assistant_content';
  end if;
  if not exists (
    select 1 from public.sessions
    where id = p_session_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'session_not_found';
  end if;

  insert into public.timeline_items (session_id, kind, role, text)
  values (p_session_id, 'message', 'assistant', p_content)
  returning id into message_id;
  update public.sessions set updated_at = timezone('utc', now()) where id = p_session_id;
  return message_id;
end;
$$;

create function public.start_chat_turn(p_user_id uuid, p_session_id uuid, p_message text)
returns jsonb
language sql
set search_path = ''
as $$ select private.start_chat_turn(p_user_id, p_session_id, p_message); $$;

create function public.complete_chat_turn(p_user_id uuid, p_session_id uuid, p_content text)
returns uuid
language sql
set search_path = ''
as $$ select private.complete_chat_turn(p_user_id, p_session_id, p_content); $$;

create function public.record_chat_provider_result(p_provider text, p_is_error boolean)
returns void
language sql
set search_path = ''
as $$ select private.record_provider_result(p_provider, p_is_error); $$;

create function public.assert_chat_provider_available(p_provider text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce((
    select state <> 'unavailable' from private.provider_health_windows
    where provider = p_provider
      and window_start >= timezone('utc', now()) - interval '10 minutes'
    order by window_start desc
    limit 1
  ), true);
$$;

revoke all on function
  private.start_chat_turn(uuid,uuid,text),
  private.complete_chat_turn(uuid,uuid,text)
from public, anon, authenticated;
grant execute on function
  private.start_chat_turn(uuid,uuid,text),
  private.complete_chat_turn(uuid,uuid,text)
to service_role;

revoke all on function
  public.start_chat_turn(uuid,uuid,text),
  public.complete_chat_turn(uuid,uuid,text),
  public.record_chat_provider_result(text,boolean),
  public.assert_chat_provider_available(text)
from public, anon, authenticated;
grant execute on function
  public.start_chat_turn(uuid,uuid,text),
  public.complete_chat_turn(uuid,uuid,text),
  public.record_chat_provider_result(text,boolean),
  public.assert_chat_provider_available(text)
to service_role;
