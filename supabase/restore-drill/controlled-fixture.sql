begin;

-- Logical/manual restore fixture. The corresponding Storage object is a
-- 1x1 PNG uploaded separately through Storage.
-- Base64: iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
-- SHA-256: 431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460
insert into auth.users (id)
values ('00000000-0000-4000-8000-00000000d101');

insert into public.sessions (id, user_id, title, created_at, updated_at)
values (
  '10000000-0000-4000-8000-00000000d101',
  '00000000-0000-4000-8000-00000000d101',
  'restore drill fixture',
  '2026-08-24T08:00:00Z',
  '2026-08-24T08:00:00Z'
);

insert into public.timeline_items (id, session_id, kind, role, text, created_at, updated_at)
values (
  '20000000-0000-4000-8000-00000000d101',
  '10000000-0000-4000-8000-00000000d101',
  'message',
  'user',
  'synthetic restore fixture',
  '2026-08-24T08:00:00Z',
  '2026-08-24T08:00:00Z'
);

insert into public.reference_uploads (
  id, user_id, session_id, storage_path, original_filename, mime_type,
  size_bytes, width, height, upload_expires_at, created_at, updated_at
)
values (
  '30000000-0000-4000-8000-00000000d101',
  '00000000-0000-4000-8000-00000000d101',
  '10000000-0000-4000-8000-00000000d101',
  '00000000-0000-4000-8000-00000000d101/10000000-0000-4000-8000-00000000d101/references/30000000-0000-4000-8000-00000000d101/reference.png',
  'restore-fixture.png',
  'image/png',
  68,
  1,
  1,
  '2026-09-23T08:00:00Z',
  '2026-08-24T08:00:00Z',
  '2026-08-24T08:00:00Z'
);

select pgmq.send(
  'image_generation',
  jsonb_build_object(
    'version', 1,
    'jobId', '40000000-0000-4000-8000-00000000d101',
    'generationId', '50000000-0000-4000-8000-00000000d101',
    'idempotencyKey', 'restore-drill-fixture',
    'correlationId', '60000000-0000-4000-8000-00000000d101'
  )
);

commit;
