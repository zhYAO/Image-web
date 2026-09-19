create or replace function private.schedule_cleanup_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_id bigint;
  scheduled_job_id bigint;
  secret_count integer;
begin
  select count(distinct name) into secret_count
  from vault.decrypted_secrets
  where name in ('zimage_project_url', 'zimage_secret_key', 'zimage_worker_cron_secret')
    and nullif(btrim(decrypted_secret), '') is not null;
  if secret_count <> 3 then
    raise exception using errcode = 'P0001', message = 'cleanup_schedule_vault_secrets_missing';
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'zimage-cleanup-worker';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  scheduled_job_id := cron.schedule(
    'zimage-cleanup-worker',
    '*/15 * * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'zimage_project_url')
          || '/functions/v1/cleanup-worker',
        headers := jsonb_build_object(
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets where name = 'zimage_secret_key'
          ),
          'Content-Type', 'application/json',
          'x-worker-secret', (
            select decrypted_secret from vault.decrypted_secrets where name = 'zimage_worker_cron_secret'
          )
        ),
        body := '{}'::jsonb
      );
    $command$
  );
  return scheduled_job_id;
end;
$$;

create or replace function private.schedule_generation_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled_image_provider_count integer;
  existing_job_id bigint;
  generation_is_enabled boolean;
  scheduled_job_id bigint;
  secret_count integer;
begin
  select enabled into generation_is_enabled
  from private.runtime_flags
  where flag = 'generation_enabled';
  if generation_is_enabled is distinct from true then
    raise exception using errcode = 'P0001', message = 'generation_schedule_disabled';
  end if;

  select count(*) into enabled_image_provider_count
  from private.provider_runtime_config
  where provider in ('gemini', 'seedream') and enabled;
  if enabled_image_provider_count < 1 then
    raise exception using errcode = 'P0001', message = 'generation_schedule_provider_missing';
  end if;

  select count(distinct name) into secret_count
  from vault.decrypted_secrets
  where name in ('zimage_project_url', 'zimage_secret_key', 'zimage_worker_cron_secret')
    and nullif(btrim(decrypted_secret), '') is not null;
  if secret_count <> 3 then
    raise exception using errcode = 'P0001', message = 'generation_schedule_vault_secrets_missing';
  end if;

  select jobid into existing_job_id from cron.job where jobname = 'zimage-generation-worker';
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  scheduled_job_id := cron.schedule(
    'zimage-generation-worker',
    '* * * * *',
    $command$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'zimage_project_url')
          || '/functions/v1/generation-worker',
        headers := jsonb_build_object(
          'apikey', (
            select decrypted_secret from vault.decrypted_secrets where name = 'zimage_secret_key'
          ),
          'Content-Type', 'application/json',
          'x-worker-secret', (
            select decrypted_secret from vault.decrypted_secrets where name = 'zimage_worker_cron_secret'
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    $command$
  );
  return scheduled_job_id;
end;
$$;
