begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.sid(label text) returns uuid language sql immutable as $$select md5('session-summary:'||label)::uuid$$;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
  (pg_temp.sid('owner'),'summary-owner@example.com',now(),false),
  (pg_temp.sid('other'),'summary-other@example.com',now(),false);
insert into auth.sessions(id,user_id) values(pg_temp.sid('login'),pg_temp.sid('owner'));
insert into public.sessions(id,user_id,title) values
  (pg_temp.sid('chat'),pg_temp.sid('owner'),'小红书海报'),
  (pg_temp.sid('mixed'),pg_temp.sid('owner'),'Mixed'),
  (pg_temp.sid('other-session'),pg_temp.sid('other'),'Other');
insert into public.commerce_tasks(id,user_id,session_id,revision,archived) values
  (pg_temp.sid('poster'),pg_temp.sid('owner'),pg_temp.sid('mixed'),2,false),
  (pg_temp.sid('commerce'),pg_temp.sid('owner'),pg_temp.sid('mixed'),1,true);
insert into public.commerce_revisions(task_id,revision,plan) values
  (pg_temp.sid('poster'),1,'{"scene":"product-set"}'),
  (pg_temp.sid('poster'),2,'{"scene":"xhs-poster"}'),
  (pg_temp.sid('commerce'),1,'{"scene":"product-main"}');
select ok(not has_function_privilege('anon','public.list_sessions_with_activity(uuid)','execute'),'anonymous cannot call summary');
select ok(not (select prosecdef from pg_proc where oid='public.list_sessions_with_activity(uuid)'::regprocedure),'summary preserves RLS as security invoker');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.sid('owner'),'session_id',pg_temp.sid('login'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.list_sessions_with_activity(pg_temp.sid('owner'))),2,'only current owner sessions');
select is((select count(*)::integer from public.list_sessions_with_activity(pg_temp.sid('other'))),0,'cannot spoof another owner');
select is((select activity_types from public.list_sessions_with_activity(pg_temp.sid('owner')) where id=pg_temp.sid('chat')),array['chat']::text[],'titles do not classify empty chats');
select is((select activity_types from public.list_sessions_with_activity(pg_temp.sid('owner')) where id=pg_temp.sid('mixed')),array['commerce','poster']::text[],'latest saved revision and archived history support mixed activities');
reset role;
select * from finish();
rollback;
