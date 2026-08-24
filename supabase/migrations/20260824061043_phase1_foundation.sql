create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '新的创作',
  status text not null default 'active',
  next_sequence bigint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint sessions_title_length check (char_length(btrim(title)) between 1 and 100),
  constraint sessions_status_check check (status in ('active', 'deleting')),
  constraint sessions_deletion_consistency check (
    (status = 'active' and deleted_at is null)
    or (status = 'deleting' and deleted_at is not null)
  )
);

create table public.generation_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  source text not null,
  status text not null default 'pending',
  prompt text not null,
  provider text not null,
  model text not null,
  config jsonb not null,
  parent_batch_id uuid references public.generation_batches (id) on delete set null,
  skill_id text,
  skill_version text,
  idempotency_key text not null,
  request_hash text not null,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint generation_batches_source_check check (source in ('direct', 'chat_tool')),
  constraint generation_batches_status_check check (status in ('pending', 'processing', 'partial', 'succeeded', 'failed')),
  constraint generation_batches_prompt_check check (char_length(btrim(prompt)) between 1 and 8000),
  constraint generation_batches_provider_check check (char_length(btrim(provider)) between 1 and 100),
  constraint generation_batches_model_check check (char_length(btrim(model)) between 1 and 200),
  constraint generation_batches_config_check check (jsonb_typeof(config) = 'object'),
  constraint generation_batches_idempotency_check check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint generation_batches_request_hash_check check (char_length(btrim(request_hash)) between 1 and 128),
  constraint generation_batches_user_idempotency_unique unique (user_id, idempotency_key),
  constraint generation_batches_id_session_unique unique (id, session_id)
);

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.generation_batches (id) on delete cascade,
  provider text not null,
  model text not null,
  status text not null default 'pending',
  prompt text not null,
  params jsonb not null,
  storage_bucket text,
  storage_path text,
  asset_status text,
  asset_expires_at timestamptz,
  error_code text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint generations_status_check check (status in ('pending', 'processing', 'succeeded', 'failed')),
  constraint generations_asset_status_check check (asset_status is null or asset_status in ('active', 'expired', 'deleted')),
  constraint generations_params_check check (jsonb_typeof(params) = 'object'),
  constraint generations_storage_pair_check check ((storage_bucket is null) = (storage_path is null)),
  constraint generations_active_asset_check check (
    asset_status is distinct from 'active'
    or (status = 'succeeded' and storage_bucket = 'generated' and asset_expires_at is not null)
  )
);

create table public.reference_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  storage_bucket text not null default 'uploads',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  width integer not null,
  height integer not null,
  status text not null default 'active',
  upload_expires_at timestamptz not null default (timezone('utc', now()) + interval '30 days'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint reference_uploads_bucket_check check (storage_bucket = 'uploads'),
  constraint reference_uploads_path_check check (char_length(btrim(storage_path)) between 1 and 1024),
  constraint reference_uploads_mime_check check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint reference_uploads_size_check check (size_bytes between 1 and 10485760),
  constraint reference_uploads_dimensions_check check (width between 1 and 16384 and height between 1 and 16384),
  constraint reference_uploads_status_check check (status in ('active', 'expired', 'deleted')),
  constraint reference_uploads_user_path_unique unique (user_id, storage_path)
);

create table public.timeline_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  sequence bigint not null,
  kind text not null,
  role text,
  text text,
  batch_id uuid,
  status text,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint timeline_items_session_sequence_unique unique (session_id, sequence),
  constraint timeline_items_kind_check check (kind in ('message', 'generation', 'error')),
  constraint timeline_items_role_check check (role is null or role in ('user', 'assistant')),
  constraint timeline_items_shape_check check (
    (kind = 'message' and role is not null and text is not null and batch_id is null)
    or (kind = 'generation' and role is null and batch_id is not null)
    or (kind = 'error' and role is null and error_code is not null)
  ),
  constraint timeline_items_batch_session_fk
    foreign key (batch_id, session_id)
    references public.generation_batches (id, session_id)
    on delete cascade
);

create table private.quota_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  batch_id uuid references public.generation_batches (id) on delete cascade,
  generation_id uuid references public.generations (id) on delete cascade,
  entry_type text not null,
  amount smallint not null,
  business_key text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  constraint quota_ledger_type_check check (entry_type in ('reserve', 'settle', 'release')),
  constraint quota_ledger_amount_check check (amount between 1 and 30),
  constraint quota_ledger_target_check check (batch_id is not null or generation_id is not null)
);

create table private.provider_health_windows (
  id bigint generated always as identity primary key,
  provider text not null,
  window_start timestamptz not null,
  total_count integer not null default 0,
  error_count integer not null default 0,
  state text not null default 'normal',
  updated_at timestamptz not null default timezone('utc', now()),
  constraint provider_health_windows_counts_check check (total_count >= 0 and error_count between 0 and total_count),
  constraint provider_health_windows_state_check check (state in ('normal', 'warning', 'unavailable')),
  constraint provider_health_windows_provider_window_unique unique (provider, window_start)
);

create table private.cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  target_id uuid not null,
  step text not null default 'queued',
  status text not null default 'pending',
  attempts integer not null default 0,
  next_run_at timestamptz not null default timezone('utc', now()),
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint cleanup_jobs_type_check check (job_type in ('session_delete', 'generation_expiry', 'reference_expiry')),
  constraint cleanup_jobs_status_check check (status in ('pending', 'processing', 'completed', 'failed')),
  constraint cleanup_jobs_attempts_check check (attempts >= 0),
  constraint cleanup_jobs_target_unique unique (job_type, target_id)
);

create table private.image_safety_audits (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations (id) on delete cascade,
  provider text not null,
  category text not null,
  decision text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint image_safety_audits_decision_check check (decision in ('allow', 'block', 'review'))
);

create index sessions_user_id_updated_at_idx on public.sessions (user_id, updated_at desc);
create index generation_batches_user_id_created_at_idx on public.generation_batches (user_id, created_at desc);
create index generation_batches_session_id_created_at_idx on public.generation_batches (session_id, created_at);
create index generations_batch_id_created_at_idx on public.generations (batch_id, created_at);
create index generations_active_expiry_idx on public.generations (asset_expires_at) where asset_status = 'active';
create index reference_uploads_session_id_idx on public.reference_uploads (session_id);
create index reference_uploads_active_expiry_idx on public.reference_uploads (upload_expires_at) where status = 'active';
create index timeline_items_session_sequence_idx on public.timeline_items (session_id, sequence);
create index quota_ledger_user_created_at_idx on private.quota_ledger (user_id, created_at);
create index cleanup_jobs_due_idx on private.cleanup_jobs (next_run_at) where status in ('pending', 'failed');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create function private.validate_generation_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_owner uuid;
  parent_owner uuid;
begin
  select user_id into session_owner
  from public.sessions
  where id = new.session_id and status = 'active';

  if session_owner is null or session_owner <> new.user_id then
    raise exception using errcode = '23514', message = 'generation batch owner must match an active session';
  end if;

  if new.parent_batch_id is not null then
    select user_id into parent_owner
    from public.generation_batches
    where id = new.parent_batch_id;
    if parent_owner is null or parent_owner <> new.user_id then
      raise exception using errcode = '23514', message = 'parent batch owner must match';
    end if;
  end if;

  if (select auth.uid()) is not null and (select auth.uid()) <> new.user_id then
    raise insufficient_privilege using message = 'generation batch owner does not match the authenticated user';
  end if;

  return new;
end;
$$;

create function private.validate_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_provider text;
  batch_model text;
begin
  select provider, model into batch_provider, batch_model
  from public.generation_batches
  where id = new.batch_id;

  if batch_provider is null or batch_provider <> new.provider or batch_model <> new.model then
    raise exception using errcode = '23514', message = 'generation provider and model must match the batch snapshot';
  end if;

  return new;
end;
$$;

create function private.validate_reference_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_owner uuid;
  active_count integer;
begin
  select user_id into session_owner
  from public.sessions
  where id = new.session_id and status = 'active'
  for update;

  if session_owner is null or session_owner <> new.user_id then
    raise exception using errcode = '23514', message = 'reference owner must match an active session';
  end if;

  if (select auth.uid()) is not null and (select auth.uid()) <> new.user_id then
    raise insufficient_privilege using message = 'reference owner does not match the authenticated user';
  end if;

  if tg_op = 'INSERT' then
    select count(*) into active_count
    from public.reference_uploads
    where session_id = new.session_id and status = 'active';
    if active_count >= 4 then
      raise exception using errcode = '23514', message = 'a session can have at most four active references';
    end if;
  end if;

  return new;
end;
$$;

create function private.allocate_timeline_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allocated_sequence bigint;
  session_owner uuid;
begin
  select user_id into session_owner
  from public.sessions
  where id = new.session_id and status = 'active';

  if session_owner is null then
    raise exception using errcode = '23503', message = 'timeline session does not exist or is deleting';
  end if;

  if (select auth.uid()) is not null and (select auth.uid()) <> session_owner then
    raise insufficient_privilege using message = 'timeline session does not belong to the authenticated user';
  end if;

  update public.sessions
  set next_sequence = next_sequence + 1
  where id = new.session_id
  returning next_sequence into allocated_sequence;

  new.sequence = allocated_sequence;
  return new;
end;
$$;

create function private.protect_generation_batch_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is distinct from new.user_id
    or old.session_id is distinct from new.session_id
    or old.source is distinct from new.source
    or old.prompt is distinct from new.prompt
    or old.provider is distinct from new.provider
    or old.model is distinct from new.model
    or old.config is distinct from new.config
    or old.parent_batch_id is distinct from new.parent_batch_id
    or old.skill_id is distinct from new.skill_id
    or old.skill_version is distinct from new.skill_version
    or old.idempotency_key is distinct from new.idempotency_key
    or old.request_hash is distinct from new.request_hash
    or old.correlation_id is distinct from new.correlation_id then
    raise exception using errcode = '23514', message = 'generation batch snapshots are immutable';
  end if;
  return new;
end;
$$;

create function private.protect_generation_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.batch_id is distinct from new.batch_id
    or old.provider is distinct from new.provider
    or old.model is distinct from new.model
    or old.prompt is distinct from new.prompt
    or old.params is distinct from new.params
    or old.correlation_id is distinct from new.correlation_id then
    raise exception using errcode = '23514', message = 'generation request snapshots are immutable';
  end if;
  return new;
end;
$$;

create function private.request_session_deletion(p_user_id uuid, p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_status text;
begin
  select status into session_status
  from public.sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if session_status is null then
    return 'not_found';
  end if;
  if session_status = 'deleting' then
    return 'already_deleting';
  end if;

  update public.sessions
  set status = 'deleting', deleted_at = timezone('utc', now())
  where id = p_session_id and user_id = p_user_id and status = 'active';

  insert into private.cleanup_jobs (job_type, target_id)
  values ('session_delete', p_session_id)
  on conflict (job_type, target_id) do nothing;

  return 'accepted';
end;
$$;

create function public.request_session_deletion(p_user_id uuid, p_session_id uuid)
returns text
language sql
set search_path = ''
as $$
  select private.request_session_deletion(p_user_id, p_session_id);
$$;

create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function private.set_updated_at();

create trigger generation_batches_validate
before insert or update on public.generation_batches
for each row execute function private.validate_generation_batch();

create trigger generation_batches_protect_snapshot
before update on public.generation_batches
for each row execute function private.protect_generation_batch_snapshot();

create trigger generation_batches_set_updated_at
before update on public.generation_batches
for each row execute function private.set_updated_at();

create trigger generations_validate
before insert or update on public.generations
for each row execute function private.validate_generation();

create trigger generations_protect_snapshot
before update on public.generations
for each row execute function private.protect_generation_snapshot();

create trigger generations_set_updated_at
before update on public.generations
for each row execute function private.set_updated_at();

create trigger reference_uploads_validate
before insert or update on public.reference_uploads
for each row execute function private.validate_reference_upload();

create trigger reference_uploads_set_updated_at
before update on public.reference_uploads
for each row execute function private.set_updated_at();

create trigger timeline_items_allocate_sequence
before insert on public.timeline_items
for each row execute function private.allocate_timeline_sequence();

create trigger timeline_items_set_updated_at
before update on public.timeline_items
for each row execute function private.set_updated_at();

create trigger provider_health_windows_set_updated_at
before update on private.provider_health_windows
for each row execute function private.set_updated_at();

create trigger cleanup_jobs_set_updated_at
before update on private.cleanup_jobs
for each row execute function private.set_updated_at();

alter table public.sessions enable row level security;
alter table public.timeline_items enable row level security;
alter table public.generation_batches enable row level security;
alter table public.generations enable row level security;
alter table public.reference_uploads enable row level security;

create policy sessions_select_own_active
on public.sessions for select to authenticated
using ((select auth.uid()) = user_id and status = 'active');

create policy sessions_insert_own
on public.sessions for insert to authenticated
with check ((select auth.uid()) = user_id and status = 'active' and deleted_at is null);

create policy sessions_update_own_active
on public.sessions for update to authenticated
using ((select auth.uid()) = user_id and status = 'active')
with check ((select auth.uid()) = user_id and status = 'active');

create policy timeline_items_select_own
on public.timeline_items for select to authenticated
using (
  exists (
    select 1 from public.sessions
    where sessions.id = timeline_items.session_id
      and sessions.user_id = (select auth.uid())
      and sessions.status = 'active'
  )
);

create policy timeline_items_insert_own
on public.timeline_items for insert to authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = timeline_items.session_id
      and sessions.user_id = (select auth.uid())
      and sessions.status = 'active'
  )
);

create policy generation_batches_select_own
on public.generation_batches for select to authenticated
using ((select auth.uid()) = user_id);

create policy generation_batches_insert_own
on public.generation_batches for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy generations_select_own
on public.generations for select to authenticated
using (
  exists (
    select 1 from public.generation_batches
    where generation_batches.id = generations.batch_id
      and generation_batches.user_id = (select auth.uid())
  )
);

create policy generations_insert_own
on public.generations for insert to authenticated
with check (
  exists (
    select 1 from public.generation_batches
    where generation_batches.id = generations.batch_id
      and generation_batches.user_id = (select auth.uid())
  )
);

create policy reference_uploads_select_own
on public.reference_uploads for select to authenticated
using ((select auth.uid()) = user_id);

create policy reference_uploads_insert_own
on public.reference_uploads for insert to authenticated
with check ((select auth.uid()) = user_id);

revoke all on table
  public.sessions,
  public.timeline_items,
  public.generation_batches,
  public.generations,
  public.reference_uploads
from public, anon, authenticated;

grant select, insert on table public.sessions to authenticated;
grant update (title) on table public.sessions to authenticated;
grant select on table public.timeline_items to authenticated;
grant select on table public.generation_batches to authenticated;
grant select on table public.generations to authenticated;
grant select, insert on table public.reference_uploads to authenticated;

grant all on table
  public.sessions,
  public.timeline_items,
  public.generation_batches,
  public.generations,
  public.reference_uploads
to service_role;

revoke all on table
  private.quota_ledger,
  private.provider_health_windows,
  private.cleanup_jobs,
  private.image_safety_audits
from public, anon, authenticated;

grant all on table
  private.quota_ledger,
  private.provider_health_windows,
  private.cleanup_jobs,
  private.image_safety_audits
to service_role;

grant usage, select on all sequences in schema private to service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;

revoke all on function public.request_session_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_session_deletion(uuid, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('uploads', 'uploads', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']),
  ('generated', 'generated', false, 31457280, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

revoke all on table storage.objects from anon, authenticated;
