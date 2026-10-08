-- Additive batch scheduling. Existing batches are left unscheduled for review.
alter table public.creative_batches add column next_attempt_at timestamptz;
create index creative_batches_due_idx on public.creative_batches(next_attempt_at, created_at)
  where next_attempt_at is not null;

create function public.claim_creative_batch_work(p_batch_id uuid default null, p_user_id uuid default null)
returns setof public.creative_batches
language sql security invoker set search_path = '' as $$
  with candidate as (
    select b.id from public.creative_batches b
    where b.next_attempt_at <= clock_timestamp()
      and (b.lease_until is null or b.lease_until < clock_timestamp())
      and (p_batch_id is null or b.id = p_batch_id)
      and (p_user_id is null or b.user_id = p_user_id)
      and exists (select 1 from jsonb_array_elements(b.items) item
        where item->>'status' in ('pending', 'created'))
    order by b.next_attempt_at, b.created_at
    limit 1 for update skip locked
  )
  update public.creative_batches b set lease_token = gen_random_uuid(),
    lease_until = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
  from candidate where b.id = candidate.id returning b.*;
$$;

create function public.checkpoint_creative_batch_work(
  p_batch_id uuid, p_lease_token uuid, p_items jsonb, p_next_attempt_at timestamptz,
  p_release boolean default false
) returns setof public.creative_batches
language sql security invoker set search_path = '' as $$
  update public.creative_batches b set items = p_items,
    next_attempt_at = p_next_attempt_at,
    lease_token = case when p_release then null else b.lease_token end,
    lease_until = case when p_release then null else clock_timestamp() + interval '120 seconds' end,
    updated_at = clock_timestamp()
  where b.id = p_batch_id and b.lease_token = p_lease_token
    and b.lease_until > clock_timestamp()
    and jsonb_typeof(p_items) = 'array'
    and jsonb_array_length(p_items) = jsonb_array_length(b.items)
  returning b.*;
$$;

revoke all on function public.claim_creative_batch_work(uuid, uuid),
  public.checkpoint_creative_batch_work(uuid, uuid, jsonb, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_creative_batch_work(uuid, uuid),
  public.checkpoint_creative_batch_work(uuid, uuid, jsonb, timestamptz, boolean)
  to service_role;

create function public.get_creative_batch_progress(p_batch_id uuid, p_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', entry.item->>'id', 'taskId', entry.item->>'taskId',
        'status', entry.item->>'status', 'error', entry.item->>'error',
        'total', counts.total, 'succeeded', counts.succeeded,
        'failed', counts.failed, 'processing', counts.processing
      ) order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(b.items) with ordinality entry(item, ordinality)
      left join lateral (
        select count(g.id)::int as total,
          count(g.id) filter (where g.status = 'succeeded')::int as succeeded,
          count(g.id) filter (where g.status = 'failed')::int as failed,
          count(g.id) filter (where g.status in ('pending', 'processing'))::int as processing
        from public.commerce_runs r
        join public.commerce_run_items i on i.run_id = r.id
        join public.generations g on g.id = i.generation_id
        where r.task_id = (entry.item->>'taskId')::uuid
          and r.request_id = (entry.item->>'submitRequestId')::uuid
      ) counts on true
    )
  ) from public.creative_batches b where b.id = p_batch_id and b.user_id = p_user_id;
$$;
revoke all on function public.get_creative_batch_progress(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_creative_batch_progress(uuid, uuid) to service_role;

create function private.wake_creative_batch_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare request_id bigint;
begin
  if not exists (
    select 1 from public.creative_batches b
    where b.next_attempt_at <= clock_timestamp()
      and (b.lease_until is null or b.lease_until < clock_timestamp())
      and exists (select 1 from jsonb_array_elements(b.items) item
        where item->>'status' in ('pending', 'created'))
  ) then return null; end if;
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'zimage_batch_worker_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-batch-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'zimage_batch_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;

create function public.schedule_creative_batch_worker() returns bigint
language plpgsql security definer set search_path = '' as $$
declare job_id bigint;
begin
  if (select count(*) from vault.decrypted_secrets
      where name in ('zimage_batch_worker_url', 'zimage_batch_cron_secret')
        and nullif(btrim(decrypted_secret), '') is not null) <> 2 then
    raise exception 'creative_batch_schedule_vault_secrets_missing';
  end if;
  select jobid into job_id from cron.job where jobname = 'zimage-creative-batch-worker';
  if job_id is not null then perform cron.unschedule(job_id); end if;
  return cron.schedule('zimage-creative-batch-worker', '* * * * *',
    'select private.wake_creative_batch_worker()');
end;
$$;

create function public.unschedule_creative_batch_worker() returns boolean
language plpgsql security definer set search_path = '' as $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname = 'zimage-creative-batch-worker';
  if job_id is null then return false; end if;
  perform cron.unschedule(job_id);
  return true;
end;
$$;

revoke all on function private.wake_creative_batch_worker(),
  public.schedule_creative_batch_worker(), public.unschedule_creative_batch_worker()
  from public, anon, authenticated;
grant execute on function public.schedule_creative_batch_worker(),
  public.unschedule_creative_batch_worker() to service_role;
