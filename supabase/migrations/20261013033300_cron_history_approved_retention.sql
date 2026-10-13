-- Dormant owner-only maintenance. No schedule, policy, grant, cleanup invocation or backfill.
-- Production execution needs an independently reviewed, frozen approval manifest.
create table private.cron_history_archive (
  runid bigint primary key,
  jobid bigint not null,
  status text not null check (status in ('succeeded', 'failed')),
  start_time timestamptz,
  end_time timestamptz not null,
  archived_at timestamptz not null default now(),
  approval_reference text not null check (length(approval_reference) between 1 and 200)
);
revoke all on private.cron_history_archive from public, anon, authenticated, service_role;

create function private.prune_approved_cron_history(
  p_job_ids bigint[],
  p_run_ids bigint[],
  p_success_cutoff timestamptz,
  p_failure_cutoff timestamptz,
  p_approved_count integer,
  p_approval_reference text
) returns integer
language plpgsql security invoker
set search_path = ''
set lock_timeout = '500ms'
as $$
declare
  v_locked bigint[];
  v_jobs integer;
  v_archived integer;
  v_deleted integer;
begin
  if p_job_ids is null or cardinality(p_job_ids) not between 1 and 20
    or (select count(distinct id) from unnest(p_job_ids) id) <> cardinality(p_job_ids)
    or p_run_ids is null or p_approved_count is null or p_approved_count not between 1 and 500
    or cardinality(p_run_ids) <> p_approved_count
    or (select count(distinct id) from unnest(p_run_ids) id) <> p_approved_count
    or p_success_cutoff is null or p_success_cutoff > now() - interval '14 days'
    or p_failure_cutoff is null or p_failure_cutoff > now() - interval '30 days'
    or p_approval_reference is null or length(btrim(p_approval_reference)) not between 1 and 200
  then
    raise exception using errcode = '22023', message = 'invalid_cron_retention_approval';
  end if;
  if not pg_try_advisory_xact_lock(7842317) then
    raise exception using errcode = '55P03', message = 'cron_retention_busy';
  end if;
  -- Current mapping is required; removed historical job IDs need separate review.
  perform jobid from cron.job where jobid = any(p_job_ids) for key share;
  get diagnostics v_jobs = row_count;
  if v_jobs <> cardinality(p_job_ids) then
    raise exception using errcode = '22023', message = 'cron_retention_scope_changed';
  end if;
  select array_agg(runid order by runid) into v_locked from (
    select d.runid from cron.job_run_details d
    where d.runid = any(p_run_ids) and d.jobid = any(p_job_ids)
      and d.end_time is not null
      and ((d.status = 'succeeded' and d.end_time < p_success_cutoff)
        or (d.status = 'failed' and d.end_time < p_failure_cutoff))
    order by d.runid for update
  ) locked;
  if coalesce(cardinality(v_locked), 0) <> p_approved_count then
    raise exception using errcode = '22023', message = 'cron_retention_scope_changed';
  end if;
  -- The archive must not become another unbounded database-growth source.
  if (select count(*) from private.cron_history_archive) + p_approved_count > 100000 then
    raise exception using errcode = '54000', message = 'cron_archive_capacity_exceeded';
  end if;
  insert into private.cron_history_archive(runid, jobid, status, start_time, end_time, approval_reference)
    select runid, jobid, status, start_time, end_time, p_approval_reference
    from cron.job_run_details where runid = any(v_locked);
  get diagnostics v_archived = row_count;
  delete from cron.job_run_details where runid = any(v_locked);
  get diagnostics v_deleted = row_count;
  if v_archived <> p_approved_count or v_deleted <> p_approved_count then
    raise exception using errcode = '22023', message = 'cron_retention_scope_changed';
  end if;
  return v_deleted;
end;
$$;
revoke all on function private.prune_approved_cron_history(bigint[], bigint[], timestamptz, timestamptz, integer, text)
  from public, anon, authenticated, service_role;
