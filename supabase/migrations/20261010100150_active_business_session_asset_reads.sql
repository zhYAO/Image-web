-- Deletion acceptance hides assets before asynchronous physical cleanup.
-- Existing restrictive live-login policies and privileged cleanup remain intact.
alter policy generation_batches_select_own on public.generation_batches
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = generation_batches.session_id
        and s.user_id = (select auth.uid()) and s.status = 'active'
    )
  );

alter policy reference_uploads_select_own on public.reference_uploads
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = reference_uploads.session_id
        and s.user_id = (select auth.uid()) and s.status = 'active'
    )
  );

-- Read-only recovery: an exact existing run confirms a submitted item even if
-- the old worker lost its batch checkpoint. Never change items or settle money.
create or replace function public.get_creative_batch_progress(p_batch_id uuid, p_user_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', entry.item->>'id', 'taskId', entry.item->>'taskId',
        'status', case when entry.item->>'status' in ('created','needs_review')
          and coalesce(counts.submitted,false) then 'submitted' else entry.item->>'status' end,
        'error', entry.item->>'error',
        'total', counts.total, 'succeeded', counts.succeeded, 'failed', counts.failed,
        'processing', counts.processing, 'review', counts.review
      ) order by entry.ordinality), '[]'::jsonb)
      from jsonb_array_elements(b.items) with ordinality entry(item, ordinality)
      left join lateral (
        select coalesce(bool_or(r.id is not null),false) as submitted,
          count(g.id)::int as total,
          count(g.id) filter (where g.status = 'succeeded')::int as succeeded,
          count(g.id) filter (where g.status = 'failed')::int as failed,
          count(g.id) filter (where g.status = 'processing' and g.error_code in
            ('provider_result_unknown','provider_reconciliation_required',
             'result_unknown','result_storage_failed','storage_pending',
             'storage_error','result_pending_storage'))::int as review,
          count(g.id) filter (where g.status = 'pending' or
            (g.status = 'processing' and (g.error_code is null or g.error_code not in
              ('provider_result_unknown','provider_reconciliation_required',
               'result_unknown','result_storage_failed','storage_pending',
               'storage_error','result_pending_storage'))))::int as processing
        from public.commerce_runs r
        join public.commerce_tasks t on t.id = r.task_id
        left join public.commerce_run_items i on i.run_id = r.id
        left join public.generations g on g.id = i.generation_id
        where r.task_id = (entry.item->>'taskId')::uuid
          and r.request_id = (entry.item->>'submitRequestId')::uuid
          and t.user_id = p_user_id and t.session_id = b.session_id
      ) counts on true
    )
  ) from public.creative_batches b
  where b.id = p_batch_id and b.user_id = p_user_id
    and exists (
      select 1 from public.sessions s
      where s.id = b.session_id and s.user_id = p_user_id and s.status = 'active'
    );
$$;
revoke all on function public.get_creative_batch_progress(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_creative_batch_progress(uuid,uuid) to service_role;
