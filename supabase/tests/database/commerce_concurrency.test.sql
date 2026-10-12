-- Local PostgreSQL only: two dblink connections use this server's Unix socket.
-- PGlite and installations without dblink/socket authentication skip explicitly.
-- Remote-connection fixtures are committed for visibility, then removed below.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create function pg_temp.commerce_concurrency() returns setof text language plpgsql as $concurrency$
declare
  owner_uuid uuid := gen_random_uuid(); session_uuid uuid := gen_random_uuid(); reference_uuid uuid := gen_random_uuid();
  slot_one uuid := gen_random_uuid(); slot_two uuid := gen_random_uuid(); task_uuid uuid;
  body jsonb; plan_json jsonb; compiled jsonb; first_result jsonb; second_result jsonb; saved_flags jsonb;
  request_one uuid := gen_random_uuid(); request_two uuid := gen_random_uuid();
  conninfo text; query_one text; query_two text; cleanup_sql text; flags_sql text;
  pid_two integer; waiting boolean; index integer; connected_a boolean := false; connected_b boolean := false;
begin
  if not exists(select 1 from pg_available_extensions where name='dblink') then
    return query select skip('local dblink extension unavailable',8); return;
  end if;
  begin
    create extension if not exists dblink with schema extensions;
    conninfo := format('host=%L port=%s dbname=%L user=%L connect_timeout=3',
      btrim(split_part(current_setting('unix_socket_directories'),',',1)),current_setting('port'),current_database(),current_user);
    perform extensions.dblink_connect('commerce_a',conninfo); connected_a := true;
    perform extensions.dblink_connect('commerce_b',conninfo); connected_b := true;
  exception when others then
    if connected_a then perform extensions.dblink_disconnect('commerce_a'); end if;
    return query select skip('local socket dblink authentication unavailable: '||sqlerrm,8); return;
  end;
  select pid into pid_two from extensions.dblink('commerce_b','select pg_backend_pid()') as r(pid integer);
  select flags into saved_flags from extensions.dblink('commerce_a',
    $$select jsonb_build_object('generation',(select enabled from private.runtime_flags where flag='generation_enabled'),
      'provider',(select enabled from private.provider_runtime_config where provider='seedream'))$$) as r(flags jsonb);
  flags_sql := format('update private.runtime_flags set enabled=%L where flag=''generation_enabled'';
    update private.provider_runtime_config set enabled=%L where provider=''seedream''',saved_flags->>'generation',saved_flags->>'provider');
  cleanup_sql := format($cleanup$
    do $inner$ declare q record; begin
      for q in select q0.msg_id from pgmq.q_image_generation q0 join public.generations g on g.id::text=q0.message->>'generationId'
        join public.generation_batches b on b.id=g.batch_id where b.user_id=%L::uuid loop
        perform pgmq.archive('image_generation',q.msg_id);
      end loop;
    end; $inner$;
    delete from pgmq.a_image_generation q using public.generations g,public.generation_batches b
      where g.id::text=q.message->>'generationId' and g.batch_id=b.id and b.user_id=%L::uuid;
    delete from public.sessions where user_id=%L::uuid;
    delete from auth.users where id=%L::uuid;
  $cleanup$,owner_uuid,owner_uuid,owner_uuid,owner_uuid);
  begin
    perform extensions.dblink_exec('commerce_a',format($seed$
      insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(%L,%L,now(),false);
      insert into public.sessions(id,user_id,title) values(%L,%L,'Commerce concurrency');
      insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)
        values(%L,%L,%L,%L,'test.webp','image/webp',10,1,1);
      update private.runtime_flags set enabled=true where flag='generation_enabled';
      update private.provider_runtime_config set enabled=true where provider='seedream';
    $seed$,owner_uuid,owner_uuid||'@commerce.test',session_uuid,owner_uuid,reference_uuid,owner_uuid,session_uuid,
      owner_uuid||'/'||session_uuid||'/race.webp'));
    plan_json := jsonb_build_object('scene','product-set','templateId','white-main','brief',jsonb_build_object(
      'name','Concurrent product','facts','','sellingPoints','','platform','taobao','placement','main',
      'productReferenceIds',jsonb_build_array(reference_uuid),'styleReferenceIds','[]'::jsonb),'slots',
      (select jsonb_agg(jsonb_build_object('id',s,'role','Product','instruction','','exactText','',
        'referenceIds',jsonb_build_array(reference_uuid),'provider','seedream','model','doubao-seedream-5.0-pro','aspectRatio','1:1','resolution','2K'))
      from unnest(array[slot_one,slot_two]) s));
    compiled := (select jsonb_agg(jsonb_build_object('slotId',s->>'id','prompt','Concurrent product','hash',md5(s::text),
      'provider','seedream','model','doubao-seedream-5.0-pro','templateVersion','1.0.0','compilerVersion','commerce-1',
      'config',jsonb_build_object('count',1,'aspectRatio','1:1','resolution','2K','referenceIds',jsonb_build_array(reference_uuid))))
      from jsonb_array_elements(plan_json->'slots') s);
    body := jsonb_build_object('requestId',gen_random_uuid(),'sessionId',session_uuid,'plan',plan_json);
    select (result->>'id')::uuid into task_uuid from extensions.dblink('commerce_a',format(
      'select public.commerce_dispatch(%L,''create'',null,%L::jsonb,%L,%L::jsonb,%L)',owner_uuid,body,md5(body::text),compiled,gen_random_uuid())) as r(result jsonb);
    -- Catch the second connection's expected conflict without leaving its
    -- transaction aborted or turning dblink notices into fake assertions.
    perform extensions.dblink_exec('commerce_b',$remote$
      create function pg_temp.try_commerce(u uuid,t uuid,b jsonb,h text) returns jsonb language plpgsql as $fn$
      begin return public.commerce_dispatch(u,'submit',t,b,h,null,gen_random_uuid());
      exception when others then return jsonb_build_object('code',sqlstate,'message',sqlerrm); end; $fn$;
    $remote$);
    body := jsonb_build_object('requestId',request_one,'revision',1,'slotIds',jsonb_build_array(slot_one));
    query_one := format('select public.commerce_dispatch(%L,''submit'',%L,%L::jsonb,%L,null,%L)',owner_uuid,task_uuid,body,md5(body::text),gen_random_uuid());
    query_two := format('select pg_temp.try_commerce(%L,%L,%L::jsonb,%L)',owner_uuid,task_uuid,body,md5(body::text));
    perform extensions.dblink_exec('commerce_a','begin');
    select result into first_result from extensions.dblink('commerce_a',query_one) as r(result jsonb);
    perform extensions.dblink_send_query('commerce_b',query_two);
    waiting := false;
    for index in 1..100 loop
      perform pg_stat_clear_snapshot();
      select coalesce(bool_or(wait_event_type='Lock' and wait_event='advisory'),false) into waiting from pg_stat_activity where pid=pid_two;
      exit when waiting; perform pg_sleep(0.01);
    end loop;
    return next ok(waiting,'simultaneous same request waits on request advisory lock');
    perform extensions.dblink_exec('commerce_a','commit');
    select result into second_result from extensions.dblink_get_result('commerce_b') as r(result jsonb);
    perform * from extensions.dblink_get_result('commerce_b') as r(result jsonb);
    return next is(second_result,first_result,'concurrent same-hash retry returns original operation result');
    select result into second_result from extensions.dblink('commerce_a',format(
      'select to_jsonb(count(*)) from public.commerce_runs where task_id=%L',task_uuid)) as r(result jsonb);
    return next is(second_result,'1'::jsonb,'same-key race commits one run');
    select result into second_result from extensions.dblink('commerce_a',format(
      'select to_jsonb(sum(amount)) from private.quota_ledger where user_id=%L and entry_type=''reserve''',owner_uuid)) as r(result jsonb);
    return next is(second_result,'1'::jsonb,'same-key race reserves one unit');

    body := jsonb_build_object('requestId',request_two,'revision',1,'slotIds',jsonb_build_array(slot_two));
    query_one := format('select public.commerce_dispatch(%L,''submit'',%L,%L::jsonb,%L,null,%L)',owner_uuid,task_uuid,body,md5(body::text),gen_random_uuid());
    body := body||jsonb_build_object('requestId',gen_random_uuid());
    query_two := format('select pg_temp.try_commerce(%L,%L,%L::jsonb,%L)',owner_uuid,task_uuid,body,md5(body::text));
    perform extensions.dblink_exec('commerce_a','begin');
    select result into first_result from extensions.dblink('commerce_a',query_one) as r(result jsonb);
    perform extensions.dblink_send_query('commerce_b',query_two);
    waiting := false;
    for index in 1..100 loop
      perform pg_stat_clear_snapshot();
      select coalesce(bool_or(wait_event_type='Lock'),false) into waiting from pg_stat_activity where pid=pid_two;
      exit when waiting; perform pg_sleep(0.01);
    end loop;
    return next ok(waiting,'different request waits for concurrent session/task mutation');
    perform extensions.dblink_exec('commerce_a','commit');
    select result into second_result from extensions.dblink_get_result('commerce_b') as r(result jsonb);
    perform * from extensions.dblink_get_result('commerce_b') as r(result jsonb);
    return next is(second_result,jsonb_build_object('code','40001','message','commerce_slot_active'),'different request loses active-slot race');
    select result into second_result from extensions.dblink('commerce_a',format(
      'select to_jsonb(count(*)) from public.commerce_runs where task_id=%L',task_uuid)) as r(result jsonb);
    return next is(second_result,'2'::jsonb,'different-key race adds only one run');
    select result into second_result from extensions.dblink('commerce_a',format(
      'select to_jsonb(sum(amount)) from private.quota_ledger where user_id=%L and entry_type=''reserve''',owner_uuid)) as r(result jsonb);
    return next is(second_result,'2'::jsonb,'different-key race does not double-reserve');
  exception when others then
    perform extensions.dblink_exec('commerce_a','rollback');
    perform extensions.dblink_cancel_query('commerce_b');
    perform extensions.dblink_disconnect('commerce_b'); connected_b := false;
    perform extensions.dblink_exec('commerce_a',cleanup_sql||flags_sql);
    perform extensions.dblink_disconnect('commerce_a'); connected_a := false;
    raise;
  end;
  perform extensions.dblink_exec('commerce_a',cleanup_sql||flags_sql);
  perform extensions.dblink_disconnect('commerce_a');
  perform extensions.dblink_disconnect('commerce_b');
end;
$concurrency$;
select * from pg_temp.commerce_concurrency();
select * from finish();
rollback;
