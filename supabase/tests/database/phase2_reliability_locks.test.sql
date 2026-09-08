-- Disposable local PostgreSQL only. Fixtures on dblink connections must commit
-- for the second connection to see them; all are removed on success/error.
begin;
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select plan(21);
create function pg_temp.reliability_lock_schedules() returns setof text language plpgsql as $test$
declare
  owner_id uuid:=gen_random_uuid(); sid uuid; gid uuid; bid uuid; job_id uuid; mid bigint;
  operation text; conninfo text; saved_flags jsonb; cleanup_sql text; claim jsonb; outcome jsonb; actual jsonb;
  legacy_sql text; pid_b integer; waiting boolean; tick integer; connected_a boolean:=false; connected_b boolean:=false;
begin
  if not exists(select 1 from pg_available_extensions where name='dblink') then
    return query select skip('local dblink extension unavailable',21); return;
  end if;
  begin
    create extension if not exists dblink with schema extensions;
    conninfo:=format('host=%L port=%s dbname=%L user=%L connect_timeout=3',
      btrim(split_part(current_setting('unix_socket_directories'),',',1)),current_setting('port'),current_database(),current_user);
    perform extensions.dblink_connect('reliability_a',conninfo); connected_a:=true;
    perform extensions.dblink_connect('reliability_b',conninfo); connected_b:=true;
  exception when others then
    if connected_a then perform extensions.dblink_disconnect('reliability_a'); end if;
    return query select skip('local dblink socket authentication unavailable: '||sqlerrm,21); return;
  end;
  perform extensions.dblink_exec('reliability_a','set timezone=''UTC''');
  perform extensions.dblink_exec('reliability_b','set timezone=''UTC''');
  select pid into pid_b from extensions.dblink('reliability_b','select pg_backend_pid()') as r(pid integer);
  select flags into saved_flags from extensions.dblink('reliability_a',
    $$select jsonb_build_object('generation',(select enabled from private.runtime_flags where flag='generation_enabled'),
      'provider',(select enabled from private.provider_runtime_config where provider='gemini'))$$) as r(flags jsonb);
  cleanup_sql:=format($cleanup$
    delete from pgmq.q_image_generation q using public.generations g,public.generation_batches b
      where q.message->>'generationId'=g.id::text and g.batch_id=b.id and b.user_id=%L;
    delete from pgmq.a_image_generation q using public.generations g,public.generation_batches b
      where q.message->>'generationId'=g.id::text and g.batch_id=b.id and b.user_id=%L;
    delete from private.cleanup_jobs where target_id in (select id from public.sessions where user_id=%L);
    delete from auth.users where id=%L;
    delete from private.generation_work where user_id=%L;
    update private.runtime_flags set enabled=%L where flag='generation_enabled';
    update private.provider_runtime_config set enabled=%L where provider='gemini';
  $cleanup$,owner_id,owner_id,owner_id,owner_id,owner_id,saved_flags->>'generation',saved_flags->>'provider');
  begin
    perform extensions.dblink_exec('reliability_a',format($seed$
      insert into auth.users(id,email,email_confirmed_at,is_anonymous) values(%L,%L,now(),false);
      update private.runtime_flags set enabled=true where flag='generation_enabled';
      update private.provider_runtime_config set enabled=true where provider='gemini';
    $seed$,owner_id,owner_id||'@reliability.test'));
    perform extensions.dblink_exec('reliability_b',$remote$
      create function pg_temp.legacy_call(statement text) returns jsonb language plpgsql as $fn$
      begin execute statement; return jsonb_build_object('ok',true);
      exception when others then return jsonb_build_object('code',sqlstate,'message',sqlerrm); end; $fn$;
      set statement_timeout='5s';
    $remote$);
    foreach operation in array array['mark','retry','fail','cleanup_complete','cleanup_fail','account_complete','account_fail'] loop
      if operation in ('mark','retry','fail') then
        select result->>'batchId' into bid from extensions.dblink('reliability_a',format(
          'select private.submit_image_generation(%L,null,''lock test'',''gemini'',''test-model'',%L::jsonb,''direct'',null,null,null,%L,%L,%L)',
          owner_id,'{"count":1,"aspectRatio":"1:1","resolution":"1K"}',gen_random_uuid(),gen_random_uuid(),gen_random_uuid())) as r(result jsonb);
        select id into gid from extensions.dblink('reliability_a',format('select id from public.generations where batch_id=%L',bid)) as r(id uuid);
        perform extensions.dblink_exec('reliability_a','begin');
        select result into claim from extensions.dblink('reliability_a','select public.claim_image_generation()') as r(result jsonb);
        if claim->>'generationId' is distinct from gid::text then raise exception 'requires isolated local queue'; end if;
        mid:=(claim->>'messageId')::bigint;
        legacy_sql:=case operation
          when 'mark' then format('select public.mark_provider_submission_started(%L)',gid)
          when 'retry' then format('select public.retry_image_generation(%L,''old'')',gid)
          else format('select public.fail_image_generation(%s,%L,''old'',true,''not_submitted'')',mid,gid) end;
      elsif operation in ('cleanup_complete','cleanup_fail') then
        sid:=gen_random_uuid(); job_id:=gen_random_uuid();
        perform extensions.dblink_exec('reliability_a',format($seed$
          insert into public.sessions(id,user_id,status,deleted_at) values(%L,%L,'deleting',now());
          insert into private.cleanup_jobs(id,job_type,target_id) values(%L,'session_delete',%L);
        $seed$,sid,owner_id,job_id,sid));
        perform extensions.dblink_exec('reliability_a','begin');
        select result into claim from extensions.dblink('reliability_a','select public.claim_cleanup_work()') as r(result jsonb);
        if claim->>'jobId' is distinct from job_id::text then raise exception 'requires isolated local cleanup queue'; end if;
        legacy_sql:=case operation when 'cleanup_complete' then format('select public.complete_cleanup_job(%L)',job_id)
          else format('select public.fail_cleanup_job(%L,''old'')',job_id) end;
      else
        perform extensions.dblink_exec('reliability_a',format($seed$
          insert into private.account_cleanup_jobs(user_id) values(%L)
          on conflict(user_id) do update set status='pending',claim_token=null,lease_until=null;
        $seed$,owner_id));
        perform extensions.dblink_exec('reliability_a','begin');
        select result into claim from extensions.dblink('reliability_a','select public.claim_account_cleanup_job()') as r(result jsonb);
        if claim->>'targetId' is distinct from owner_id::text then raise exception 'requires isolated account cleanup queue'; end if;
        legacy_sql:=case operation when 'account_complete' then format('select public.complete_account_cleanup_job(%L)',owner_id)
          else format('select public.fail_account_cleanup_job(%L,''old'')',owner_id) end;
      end if;
      perform extensions.dblink_send_query('reliability_b',format('select pg_temp.legacy_call(%L)',legacy_sql));
      waiting:=false;
      for tick in 1..100 loop
        perform pg_stat_clear_snapshot();
        select coalesce(bool_or(wait_event_type='Lock'),false) into waiting from pg_stat_activity where pid=pid_b;
        exit when waiting; perform pg_sleep(0.01);
      end loop;
      return next ok(waiting,operation||': legacy call waits for uncommitted claimant');
      perform extensions.dblink_exec('reliability_a','commit');
      select result into outcome from extensions.dblink_get_result('reliability_b') as r(result jsonb);
      perform * from extensions.dblink_get_result('reliability_b') as r(result jsonb);
      return next is(outcome,jsonb_build_object('code','P0001','message',case when operation in ('mark','retry','fail')
        then 'generation_lease_lost' else 'cleanup_lease_lost' end),operation||': locked current fence rejects legacy caller');
      if operation in ('mark','retry','fail') then
        select result into actual from extensions.dblink('reliability_a',format($state$
          select jsonb_build_object('status',g.status,'submission',g.provider_submission_state,
            'reserve',(select count(*) from private.quota_ledger where generation_id=g.id and entry_type='reserve'),
            'release',(select count(*) from private.quota_ledger where generation_id=g.id and entry_type='release'),
            'queued',exists(select 1 from pgmq.q_image_generation where msg_id=%s)) from public.generations g where id=%L
        $state$,mid,gid)) as r(result jsonb);
        return next is(actual,'{"status":"processing","submission":"not_submitted","reserve":1,"release":0,"queued":true}'::jsonb,
          operation||': successor generation, quota and message unchanged');
      else
        select result into actual from extensions.dblink('reliability_a',case when operation in ('cleanup_complete','cleanup_fail')
          then format('select to_jsonb(status) from private.cleanup_jobs where id=%L',job_id)
          else format('select to_jsonb(status) from private.account_cleanup_jobs where user_id=%L',owner_id) end) as r(result jsonb);
        return next is(actual,'"processing"'::jsonb,operation||': successor cleanup remains processing');
      end if;
    end loop;
  exception when others then
    perform extensions.dblink_exec('reliability_a','rollback');
    perform extensions.dblink_cancel_query('reliability_b');
    perform extensions.dblink_disconnect('reliability_b'); connected_b:=false;
    perform extensions.dblink_exec('reliability_a',cleanup_sql);
    perform extensions.dblink_disconnect('reliability_a'); connected_a:=false;
    raise;
  end;
  perform extensions.dblink_exec('reliability_a',cleanup_sql);
  perform extensions.dblink_disconnect('reliability_a');
  perform extensions.dblink_disconnect('reliability_b');
end;
$test$;
select * from pg_temp.reliability_lock_schedules();
select * from finish();
rollback;
