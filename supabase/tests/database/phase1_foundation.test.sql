begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select has_table('public', 'sessions', 'sessions exists');
select has_table('public', 'timeline_items', 'timeline_items exists');
select has_table('public', 'generation_batches', 'generation_batches exists');
select has_table('public', 'generations', 'generations exists');
select has_table('public', 'reference_uploads', 'reference_uploads exists');
select has_table('private', 'quota_ledger', 'quota_ledger exists');
select has_table('private', 'provider_health_windows', 'provider_health_windows exists');
select has_table('private', 'cleanup_jobs', 'cleanup_jobs exists');
select has_table('private', 'image_safety_audits', 'image_safety_audits exists');

select ok((select relrowsecurity from pg_class where oid = 'public.sessions'::regclass), 'sessions has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.timeline_items'::regclass), 'timeline_items has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.generation_batches'::regclass), 'generation_batches has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.generations'::regclass), 'generations has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.reference_uploads'::regclass), 'reference_uploads has RLS');

select ok(not has_table_privilege('anon', 'public.sessions', 'select'), 'anon cannot select sessions');
select ok(not has_table_privilege('anon', 'public.timeline_items', 'select'), 'anon cannot select timeline items');
select ok(not has_table_privilege('anon', 'public.generation_batches', 'select'), 'anon cannot select batches');
select ok(not has_table_privilege('anon', 'public.generations', 'select'), 'anon cannot select generations');
select ok(not has_table_privilege('anon', 'public.reference_uploads', 'select'), 'anon cannot select references');

select ok(has_table_privilege('authenticated', 'public.sessions', 'select'), 'authenticated can select sessions');
select ok(has_table_privilege('authenticated', 'public.sessions', 'insert'), 'authenticated can insert sessions');
select ok(has_column_privilege('authenticated', 'public.sessions', 'title', 'update'), 'authenticated can rename sessions');
select ok(not has_table_privilege('authenticated', 'public.sessions', 'delete'), 'authenticated cannot directly delete sessions');
select ok(has_table_privilege('authenticated', 'public.timeline_items', 'select'), 'authenticated can select timeline items');
select ok(not has_table_privilege('authenticated', 'public.timeline_items', 'insert'), 'authenticated cannot bypass the chat service');
select ok(has_table_privilege('authenticated', 'public.generation_batches', 'select'), 'authenticated can select batches');
select ok(not has_table_privilege('authenticated', 'public.generation_batches', 'insert'), 'authenticated cannot bypass generation submission');
select ok(has_table_privilege('authenticated', 'public.generations', 'select'), 'authenticated can select generations');
select ok(not has_table_privilege('authenticated', 'public.generations', 'insert'), 'authenticated cannot bypass quota reservation');
select ok(has_table_privilege('authenticated', 'public.reference_uploads', 'select'), 'authenticated can select references');
select ok(has_table_privilege('authenticated', 'public.reference_uploads', 'insert'), 'authenticated can insert references');

select ok(not has_table_privilege('authenticated', 'private.quota_ledger', 'select'), 'quota ledger is server-only');
select ok(not has_table_privilege('authenticated', 'private.provider_health_windows', 'select'), 'health windows are server-only');
select ok(not has_table_privilege('authenticated', 'private.cleanup_jobs', 'select'), 'cleanup jobs are server-only');
select ok(not has_table_privilege('authenticated', 'private.image_safety_audits', 'select'), 'safety audits are server-only');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated cannot use private schema');
select ok(
  not has_function_privilege('authenticated', 'public.request_session_deletion(uuid,uuid)', 'execute'),
  'authenticated cannot call the privileged delete transition directly'
);
select ok(
  has_function_privilege('service_role', 'public.request_session_deletion(uuid,uuid)', 'execute'),
  'service role can call the privileged delete transition'
);

select results_eq(
  $$select public from storage.buckets where id = 'uploads'$$,
  array[false],
  'uploads bucket is private'
);
select results_eq(
  $$select public from storage.buckets where id = 'generated'$$,
  array[false],
  'generated bucket is private'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2');

insert into public.sessions (id, user_id, title)
values
  ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'owner session'),
  ('10000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'other session');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.sessions$$,
  array[1::bigint],
  'RLS exposes only the current user sessions'
);

select lives_ok(
  $$insert into public.sessions (id, user_id, title) values ('10000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'allowed')$$,
  'the owner can create a session'
);

select throws_ok(
  $$insert into public.sessions (id, user_id, title) values ('10000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', 'forbidden')$$,
  '42501',
  'new row violates row-level security policy for table "sessions"',
  'a user cannot create a session for another owner'
);

reset role;
insert into public.timeline_items (id, session_id, kind, role, text)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 'message', 'user', 'first'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 'message', 'assistant', 'second');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select results_eq(
  $$select sequence from public.timeline_items where session_id = '10000000-0000-0000-0000-0000000000a1' order by sequence$$,
  array[1::bigint, 2::bigint],
  'timeline sequence is allocated atomically and remains stable'
);

select * from finish();
rollback;
