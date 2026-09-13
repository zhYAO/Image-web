-- Summarize actual saved work in one request, under the caller's existing RLS.
create or replace function public.list_sessions_with_activity(p_user_id uuid)
returns table(id uuid, title text, status text, created_at timestamptz, updated_at timestamptz, activity_types text[])
language sql stable security invoker set search_path = ''
as $$
  with owned_sessions as materialized (
    select s.* from public.sessions s
    where s.user_id = p_user_id and s.user_id = (select auth.uid()) and s.status = 'active'
  ), activity as (
    select b.session_id, 'image'::text as kind
    from public.generation_batches b join owned_sessions s on s.id = b.session_id
    where b.user_id = p_user_id and not exists (
      select 1 from public.commerce_run_items i where i.batch_id = b.id
    )
    union
    select t.session_id, case when r.plan->>'scene' = 'xhs-poster' then 'poster' else 'commerce' end
    from public.commerce_tasks t join owned_sessions s on s.id = t.session_id
    join public.commerce_revisions r on r.task_id = t.id and r.revision = t.revision
    where t.user_id = p_user_id
  ), summary as (
    select a.session_id, array_agg(distinct a.kind order by a.kind) as kinds from activity a group by a.session_id
  )
  select s.id, s.title, s.status, s.created_at, s.updated_at, coalesce(a.kinds, array['chat']::text[])
  from owned_sessions s left join summary a on a.session_id = s.id
  order by s.updated_at desc, s.id;
$$;
revoke all on function public.list_sessions_with_activity(uuid) from public, anon;
grant execute on function public.list_sessions_with_activity(uuid) to authenticated;
