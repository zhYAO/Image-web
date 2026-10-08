-- A generation awaiting provider reconciliation is not active work. Keep its
-- credit hold and expose it separately so the batch stops automatic refresh.
create or replace function public.get_creative_batch_progress(p_batch_id uuid, p_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', entry.item->>'id', 'taskId', entry.item->>'taskId',
        'status', entry.item->>'status', 'error', entry.item->>'error',
        'total', counts.total, 'succeeded', counts.succeeded,
        'failed', counts.failed, 'processing', counts.processing,
        'review', counts.review
      ) order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(b.items) with ordinality entry(item, ordinality)
      left join lateral (
        select count(g.id)::int as total,
          count(g.id) filter (where g.status = 'succeeded')::int as succeeded,
          count(g.id) filter (where g.status = 'failed')::int as failed,
          count(g.id) filter (where g.status = 'processing' and g.error_code in
            ('provider_result_unknown', 'provider_reconciliation_required',
             'result_unknown', 'result_storage_failed', 'storage_pending',
             'storage_error', 'result_pending_storage'))::int as review,
          count(g.id) filter (where g.status = 'pending' or
            (g.status = 'processing' and (g.error_code is null or g.error_code not in
              ('provider_result_unknown', 'provider_reconciliation_required',
               'result_unknown', 'result_storage_failed', 'storage_pending',
               'storage_error', 'result_pending_storage'))))::int as processing
        from public.commerce_runs r
        join public.commerce_run_items i on i.run_id = r.id
        join public.generations g on g.id = i.generation_id
        where r.task_id = (entry.item->>'taskId')::uuid
          and r.request_id = (entry.item->>'submitRequestId')::uuid
      ) counts on true
    )
  ) from public.creative_batches b where b.id = p_batch_id and b.user_id = p_user_id;
$$;
