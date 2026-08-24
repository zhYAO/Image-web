create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function private.schedule_cleanup_worker()
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
  where name in ('zimage_project_url', 'zimage_service_role_key', 'zimage_worker_cron_secret')
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
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets where name = 'zimage_service_role_key'
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

create function private.unschedule_cleanup_worker()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'zimage-cleanup-worker';
  if existing_job_id is null then return false; end if;
  perform cron.unschedule(existing_job_id);
  return true;
end;
$$;

create function public.schedule_cleanup_worker()
returns bigint
language sql
set search_path = ''
as $$ select private.schedule_cleanup_worker(); $$;

create function public.unschedule_cleanup_worker()
returns boolean
language sql
set search_path = ''
as $$ select private.unschedule_cleanup_worker(); $$;

revoke all on function
  private.schedule_cleanup_worker(),
  private.unschedule_cleanup_worker(),
  public.schedule_cleanup_worker(),
  public.unschedule_cleanup_worker()
from public, anon, authenticated;

grant execute on function
  private.schedule_cleanup_worker(),
  private.unschedule_cleanup_worker(),
  public.schedule_cleanup_worker(),
  public.unschedule_cleanup_worker()
to service_role;
