begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select has_extension('pg_cron', 'pg_cron is installed');
select has_extension('pg_net', 'pg_net is installed');
select has_function('public', 'schedule_cleanup_worker', array[]::text[], 'cleanup scheduling RPC exists');
select has_function('public', 'unschedule_cleanup_worker', array[]::text[], 'cleanup unscheduling RPC exists');
select ok(
  has_function_privilege('service_role', 'public.schedule_cleanup_worker()', 'execute'),
  'service role can create the cleanup schedule after Vault setup'
);
select ok(
  not has_function_privilege('authenticated', 'public.schedule_cleanup_worker()', 'execute'),
  'authenticated users cannot create cron jobs'
);

select * from finish();
rollback;
