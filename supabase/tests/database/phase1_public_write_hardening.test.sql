begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select ok(
  not has_table_privilege('authenticated', 'public.sessions', 'INSERT'),
  'authenticated users cannot bypass session creation quotas through PostgREST'
);
select ok(
  not has_column_privilege('authenticated', 'public.sessions', 'title', 'UPDATE'),
  'authenticated users cannot bypass write quotas through direct session updates'
);
select ok(
  not has_table_privilege('authenticated', 'public.reference_uploads', 'INSERT'),
  'authenticated users cannot create upload metadata outside the validated route'
);
select ok(
  has_table_privilege('service_role', 'public.sessions', 'INSERT'),
  'the trusted server can create sessions'
);
select ok(
  has_table_privilege('service_role', 'public.reference_uploads', 'INSERT'),
  'the trusted server can persist validated upload metadata'
);
select has_function(
  'public', 'commit_preview_usage', array['uuid', 'text'],
  'usage commits require the owning user'
);
select has_function(
  'public', 'release_preview_usage', array['uuid', 'text', 'uuid'],
  'usage releases require the owning user and correlation'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.release_preview_usage(uuid,text,uuid)', 'execute'
  ),
  'authenticated users cannot release reservations'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'private.preview_usage_ledger'::regclass
      and conname = 'preview_usage_user_business_metric_unique'
  ),
  'usage idempotency is scoped to user, business key and metric'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2');

select lives_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000d1', 'session_update', 0, false,
    'shared-business-key', '10000000-0000-0000-0000-0000000000d1'
  )$$,
  'the first user can reserve a business key'
);
select lives_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000d2', 'session_update', 0, false,
    'shared-business-key', '10000000-0000-0000-0000-0000000000d2'
  )$$,
  'a second user can independently reserve the same business key'
);
select is(
  public.release_preview_usage(
    '00000000-0000-0000-0000-0000000000d1',
    'shared-business-key',
    '10000000-0000-0000-0000-0000000000d2'
  ),
  false,
  'a competing correlation cannot release the owner reservation'
);
select is(
  public.commit_preview_usage(
    '00000000-0000-0000-0000-0000000000d1', 'shared-business-key'
  ),
  true,
  'the owner can commit its reservation'
);
select is(
  public.release_preview_usage(
    '00000000-0000-0000-0000-0000000000d1',
    'shared-business-key',
    '10000000-0000-0000-0000-0000000000d1'
  ),
  false,
  'a committed reservation cannot be released'
);

select * from finish();
rollback;
