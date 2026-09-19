with fixture as (
  select jsonb_build_object(
    'session', (
      select jsonb_build_object('id', id, 'user_id', user_id, 'title', title, 'status', status)
      from public.sessions where id = '10000000-0000-4000-8000-00000000d101'
    ),
    'timeline', (
      select jsonb_build_object(
        'id', id, 'session_id', session_id, 'kind', kind,
        'role', role, 'text', text, 'sequence', sequence
      )
      from public.timeline_items where id = '20000000-0000-4000-8000-00000000d101'
    ),
    'upload', (
      select jsonb_build_object(
        'id', id, 'user_id', user_id, 'session_id', session_id,
        'storage_path', storage_path, 'mime_type', mime_type,
        'size_bytes', size_bytes, 'width', width, 'height', height, 'status', status
      )
      from public.reference_uploads where id = '30000000-0000-4000-8000-00000000d101'
    ),
    'queue', (
      select message - 'enqueuedAt'
      from pgmq.q_image_generation
      where message ->> 'idempotencyKey' = 'restore-drill-fixture'
      order by msg_id
      limit 1
    )
  ) as value
)
select encode(extensions.digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex') as logical_sha256
from fixture;

select jsonb_build_object(
  'application_tables', (
    select count(*) from information_schema.tables
    where table_schema in ('public', 'private') and table_type = 'BASE TABLE'
  ),
  'application_functions', (
    select count(*)
    from pg_proc functions
    join pg_namespace schemas on schemas.oid = functions.pronamespace
    where schemas.nspname in ('public', 'private')
      and functions.prokind = 'f'
      and not exists (
        select 1 from pg_depend dependencies
        where dependencies.classid = 'pg_proc'::regclass
          and dependencies.objid = functions.oid
          and dependencies.deptype = 'e'
      )
  ),
  'application_policies', (
    select count(*) from pg_policies where schemaname in ('public', 'private')
  ),
  'storage_objects', (
    select count(*) from storage.objects where name like '%00000000d101%'
  )
) as inventory;
