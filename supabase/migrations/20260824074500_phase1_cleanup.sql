create function private.claim_cleanup_job()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.cleanup_jobs%rowtype;
  objects jsonb;
begin
  insert into private.cleanup_jobs (job_type, target_id)
  select 'generation_expiry', id from public.generations
  where asset_status = 'active' and asset_expires_at <= timezone('utc', now())
  on conflict (job_type, target_id) do nothing;

  insert into private.cleanup_jobs (job_type, target_id)
  select 'reference_expiry', id from public.reference_uploads
  where status = 'active' and upload_expires_at <= timezone('utc', now())
  on conflict (job_type, target_id) do nothing;

  select * into target
  from private.cleanup_jobs
  where (
      status in ('pending', 'failed')
      or (status = 'processing' and updated_at <= timezone('utc', now()) - interval '5 minutes')
    )
    and attempts < 5
    and next_run_at <= timezone('utc', now())
  order by next_run_at, created_at
  for update skip locked
  limit 1;
  if target.id is null then return null; end if;

  update private.cleanup_jobs
  set status = 'processing', attempts = attempts + 1, error_code = null
  where id = target.id
  returning * into target;

  if target.job_type = 'session_delete' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into objects
    from (
      select jsonb_build_object('bucket', storage_bucket, 'path', storage_path) item
      from public.reference_uploads where session_id = target.target_id and status <> 'deleted'
      union all
      select jsonb_build_object('bucket', generations.storage_bucket, 'path', generations.storage_path)
      from public.generations
      join public.generation_batches on generation_batches.id = generations.batch_id
      where generation_batches.session_id = target.target_id and generations.storage_path is not null
    ) paths;
  elsif target.job_type = 'generation_expiry' then
    select coalesce(jsonb_agg(jsonb_build_object('bucket', storage_bucket, 'path', storage_path)), '[]'::jsonb)
    into objects from public.generations where id = target.target_id and storage_path is not null;
  else
    select coalesce(jsonb_agg(jsonb_build_object('bucket', storage_bucket, 'path', storage_path)), '[]'::jsonb)
    into objects from public.reference_uploads where id = target.target_id and status = 'active';
  end if;

  return jsonb_build_object(
    'attempt', target.attempts,
    'jobId', target.id,
    'jobType', target.job_type,
    'objects', objects,
    'targetId', target.target_id
  );
end;
$$;

create function private.complete_cleanup_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.cleanup_jobs%rowtype;
begin
  select * into target from private.cleanup_jobs where id = p_job_id and status = 'processing' for update;
  if target.id is null then return false; end if;

  if target.job_type = 'session_delete' then
    if to_regclass('langgraph.checkpoints') is not null then
      execute 'delete from langgraph.checkpoint_writes where thread_id = $1' using target.target_id::text;
      execute 'delete from langgraph.checkpoint_blobs where thread_id = $1' using target.target_id::text;
      execute 'delete from langgraph.checkpoints where thread_id = $1' using target.target_id::text;
    end if;
    delete from public.sessions where id = target.target_id and status = 'deleting';
  elsif target.job_type = 'generation_expiry' then
    update public.generations
    set asset_status = 'expired', storage_bucket = null, storage_path = null
    where id = target.target_id and asset_status = 'active';
  else
    update public.reference_uploads set status = 'expired'
    where id = target.target_id and status = 'active';
  end if;

  update private.cleanup_jobs set status = 'completed', error_code = null where id = target.id;
  return true;
end;
$$;

create function private.fail_cleanup_job(p_job_id uuid, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.cleanup_jobs%rowtype;
begin
  update private.cleanup_jobs
  set
    error_code = left(p_error_code, 100),
    next_run_at = case when attempts >= 5
      then timezone('utc', now()) + interval '100 years'
      else timezone('utc', now()) + make_interval(secs => least(3600, 30 * (2 ^ greatest(attempts - 1, 0))))
    end,
    status = 'failed'
  where id = p_job_id and status = 'processing'
  returning * into target;
  return jsonb_build_object('attempts', target.attempts, 'dead', coalesce(target.attempts >= 5, false));
end;
$$;

create function public.claim_cleanup_job() returns jsonb
language sql set search_path = '' as $$ select private.claim_cleanup_job(); $$;
create function public.complete_cleanup_job(p_job_id uuid) returns boolean
language sql set search_path = '' as $$ select private.complete_cleanup_job(p_job_id); $$;
create function public.fail_cleanup_job(p_job_id uuid, p_error_code text) returns jsonb
language sql set search_path = '' as $$ select private.fail_cleanup_job(p_job_id, p_error_code); $$;

revoke all on function
  private.claim_cleanup_job(), private.complete_cleanup_job(uuid), private.fail_cleanup_job(uuid,text)
from public, anon, authenticated;
grant execute on function
  private.claim_cleanup_job(), private.complete_cleanup_job(uuid), private.fail_cleanup_job(uuid,text)
to service_role;
revoke all on function
  public.claim_cleanup_job(), public.complete_cleanup_job(uuid), public.fail_cleanup_job(uuid,text)
from public, anon, authenticated;
grant execute on function
  public.claim_cleanup_job(), public.complete_cleanup_job(uuid), public.fail_cleanup_job(uuid,text)
to service_role;
