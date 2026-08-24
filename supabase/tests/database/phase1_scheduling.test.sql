begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

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
select has_function('public', 'schedule_generation_worker', array[]::text[], 'generation scheduling RPC exists');
select has_function('public', 'unschedule_generation_worker', array[]::text[], 'generation unscheduling RPC exists');
select ok(
  has_function_privilege('service_role', 'public.schedule_generation_worker()', 'execute'),
  'service role can create the generation schedule after provider activation'
);
select ok(
  not has_function_privilege('authenticated', 'public.schedule_generation_worker()', 'execute'),
  'authenticated users cannot schedule generation work'
);
do $$
declare scheduled_job record;
begin
  for scheduled_job in select jobid from cron.job where jobname = 'zimage-generation-worker' loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
end;
$$;
update private.runtime_flags set enabled = false where flag = 'generation_enabled';
update private.provider_runtime_config set enabled = false where provider in ('gemini', 'seedream');

select throws_ok(
  'select private.schedule_generation_worker()',
  'P0001',
  'generation_schedule_disabled',
  'generation scheduling rejects a disabled global runtime flag'
);
select is(
  (select count(*)::bigint from cron.job where jobname = 'zimage-generation-worker'),
  0::bigint,
  'disabled generation leaves no Cron job'
);

update private.runtime_flags set enabled = true where flag = 'generation_enabled';
select throws_ok(
  'select private.schedule_generation_worker()',
  'P0001',
  'generation_schedule_provider_missing',
  'generation scheduling rejects missing image providers'
);
select is(
  (select count(*)::bigint from cron.job where jobname = 'zimage-generation-worker'),
  0::bigint,
  'missing image providers leave no Cron job'
);

update private.provider_runtime_config
set enabled = true, evidence = 'phase1b scheduling transaction probe'
where provider = 'gemini';
delete from vault.secrets
where name in ('zimage_project_url', 'zimage_service_role_key', 'zimage_worker_cron_secret');
select throws_ok(
  'select private.schedule_generation_worker()',
  'P0001',
  'generation_schedule_vault_secrets_missing',
  'generation scheduling rejects missing worker secrets'
);
select is(
  (select count(*)::bigint from cron.job where jobname = 'zimage-generation-worker'),
  0::bigint,
  'missing worker secrets leave no Cron job'
);
select matches(
  coalesce(pg_get_functiondef(to_regprocedure('private.schedule_generation_worker()')), ''),
  'zimage-generation-worker',
  'generation scheduling uses the dedicated worker job name'
);

select * from finish();
rollback;
