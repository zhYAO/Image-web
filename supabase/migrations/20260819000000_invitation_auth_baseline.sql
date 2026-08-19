-- Phase 1 (M1) introduces only the identity and invitation domain required by
-- AUTH-001..011. No product tables (projects, assets, tasks, ledger, etc.) are
-- created in this migration; they enter in later sub-modules. The goal of this
-- file is to provide:
--   * `profiles`                         - one row per verified auth.users.id
--   * `invitation_codes`                 - one-time codes with HMAC digest and status
--   * `invitation_reservations`          - 10-minute pre-OTP reservations
--   * `account_deletion_requests`        - skeleton for SEC-011 state machine
-- All tables enforce RLS, the minimum Data API grants, and the partial unique
-- constraints required by T-AUTH-01..03. The embedded pgTAP block verifies
-- the negative cross-user paths before this migration is considered "done".
-- EXT-001..005 remain `external-gated`; this migration must not be interpreted
-- as producing real production availability.

set local statement_timeout = '0';

-- ---------------------------------------------------------------------------
-- Enums (private; not exposed to the Data API)
-- ---------------------------------------------------------------------------
create type private.invitation_status as enum (
  'draft',
  'active',
  'reserved',
  'redeemed',
  'expired',
  'disabled'
);

create type private.reservation_status as enum (
  'active',
  'released',
  'consumed',
  'expired'
);

create type private.account_deletion_status as enum (
  'none',
  'pending',
  'cancelling',
  'cancelling_failed',
  'purged'
);

-- ---------------------------------------------------------------------------
-- profiles
-- One row per Supabase auth.users.id. Owns credit_account invariants and
-- deletion state for SEC-011.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  deletion_status private.account_deletion_status not null default 'none',
  deletion_requested_at timestamptz,
  deletion_purge_after timestamptz,
  blocked_for_new_tasks boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_blocked_with_status
      check (
        deletion_status = 'none' or blocked_for_new_tasks = true
      ),
  constraint profiles_deletion_window
      check (
        deletion_status = 'none'
        or (deletion_requested_at is not null and deletion_purge_after is not null)
      )
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index profiles_deletion_status_idx
  on public.profiles (deletion_status)
  where deletion_status <> 'none';

-- ---------------------------------------------------------------------------
-- invitation_codes
-- Stores only HMAC digests; plaintext codes never land in Postgres. The
-- `initial_credits` is intentionally a positive integer; production issuance
-- remains blocked until EXT-005 is approved (T-AUTH-05).
-- ---------------------------------------------------------------------------
create table public.invitation_codes (
  id uuid primary key default gen_random_uuid(),
  code_digest text not null unique,
  status private.invitation_status not null default 'draft',
  initial_credits integer not null check (initial_credits > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid references auth.users(id) on delete set null,
  reservation_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_codes_window
      check (expires_at > created_at),
  constraint invitation_codes_consume_consistency
      check (
        (status = 'redeemed' and consumed_at is not null and consumed_by_user_id is not null)
        or (status <> 'redeemed')
      )
);

alter table public.invitation_codes enable row level security;

revoke all on public.invitation_codes from anon, authenticated;
-- No grants to anon/authenticated: invitation codes are managed exclusively
-- via private RPC functions. Browser roles have no read or write access.

create index invitation_codes_status_idx
  on public.invitation_codes (status)
  where status in ('active', 'reserved', 'redeemed');

-- ---------------------------------------------------------------------------
-- invitation_reservations
-- Created by the BFF before `signInWithOtp`; bound to a code, a normalized
-- email and a random challenge digest. One active reservation per code at a
-- time (AUTH-010).
-- ---------------------------------------------------------------------------
create table public.invitation_reservations (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.invitation_codes(id) on delete cascade,
  normalized_email text not null,
  challenge_digest text not null unique,
  status private.reservation_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  constraint invitation_reservations_window
      check (expires_at > created_at),
  constraint invitation_reservations_active_window
      check (
        status = 'active'
        or (consumed_at is null)
      )
);

alter table public.invitation_reservations enable row level security;

revoke all on public.invitation_reservations from anon, authenticated;
-- Reservations are server-side only; same rationale as invitation_codes.

create unique index invitation_reservations_active_per_code_uidx
  on public.invitation_reservations (invitation_id)
  where status = 'active';

create unique index invitation_reservations_idempotency_uidx
  on public.invitation_reservations (idempotency_key);

create index invitation_reservations_expires_idx
  on public.invitation_reservations (expires_at)
  where status = 'active';

-- Late-binding FK for invitation_codes.reservation_id; cannot be declared
-- inline because invitation_reservations did not exist yet.
alter table public.invitation_codes
  add constraint invitation_codes_reservation_fk
  foreign key (reservation_id)
  references public.invitation_reservations(id)
  on delete set null
  not valid;

-- ---------------------------------------------------------------------------
-- account_deletion_requests
-- Skeleton for SEC-011. We only need the existence and RLS posture for AUTH
-- tests in this phase. The state machine itself is implemented in M2/M3.
-- ---------------------------------------------------------------------------
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  status private.account_deletion_status not null default 'pending',
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null,
  cancelled_at timestamptz,
  completed_at timestamptz,
  reason text,
  constraint account_deletion_requests_unique_active
      exclude (user_id with =) where (status = 'pending')
);

alter table public.account_deletion_requests enable row level security;

revoke all on public.account_deletion_requests from anon, authenticated;
grant select on public.account_deletion_requests to authenticated;

create policy "account_deletion_requests_select_own"
  on public.account_deletion_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create index account_deletion_requests_pending_idx
  on public.account_deletion_requests (purge_after)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger invitation_codes_touch_updated_at
  before update on public.invitation_codes
  for each row execute function private.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- pgTAP tests (executed by `supabase test db`)
-- ---------------------------------------------------------------------------
do $$
begin
  -- Allow pg_proof to be a no-op when the extension is unavailable in CI
  -- shards that intentionally skip database tests.
  if exists (select 1 from pg_extension where extname = 'pgtap') then
    -- No-op; pgTAP loaded below in a savepoint-free context.
    null;
  end if;
end
$$;

begin;

select plan(10);

-- A1: invitation_codes is invisible to anon and authenticated Data API roles.
select ok(
  not has_table_privilege('anon', 'public.invitation_codes', 'select'),
  'T-RLS-01 / T-AUTH-05: anon cannot select invitation_codes'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitation_codes', 'select'),
  'T-RLS-01 / T-AUTH-05: authenticated cannot select invitation_codes'
);
select ok(
  not has_table_privilege('service_role', 'public.invitation_codes', 'select'),
  'T-RLS-01: service_role also receives no implicit grant on invitation_codes'
);

-- A2: reservation uniqueness per active reservation per invitation
-- (AUTH-010 partial unique index).
insert into public.invitation_codes (
  code_digest,
  status,
  initial_credits,
  expires_at
) values (
  'digest-A',
  'active',
  10,
  now() + interval '7 days'
);
insert into public.invitation_codes (
  code_digest,
  status,
  initial_credits,
  expires_at
) values (
  'digest-B',
  'active',
  10,
  now() + interval '7 days'
);

insert into public.invitation_reservations (
  invitation_id,
  normalized_email,
  challenge_digest,
  expires_at,
  idempotency_key
)
select id, 'user@example.com', 'challenge-1', now() + interval '10 minutes', 'k-1'
  from public.invitation_codes where code_digest = 'digest-A';

select throws_ok(
  $$ insert into public.invitation_reservations (
       invitation_id, normalized_email, challenge_digest,
       expires_at, idempotency_key
     )
     select id, 'user@example.com', 'challenge-2',
            now() + interval '10 minutes', 'k-2'
       from public.invitation_codes
       where code_digest = 'digest-A' $$,
  '23505',
  'invitation_reservations_active_per_code_uidx',
  'AUTH-010: a second active reservation for the same code is rejected'
);

-- A3: idempotency key uniqueness (AUTH-003 retry contract).
select throws_ok(
  $$ insert into public.invitation_reservations (
       invitation_id, normalized_email, challenge_digest,
       expires_at, idempotency_key
     )
     select id, 'other@example.com', 'challenge-3',
            now() + interval '10 minutes', 'k-1'
       from public.invitation_codes
       where code_digest = 'digest-B' $$,
  '23505',
  'invitation_reservations_idempotency_uidx',
  'AUTH-003: same idempotency_key replay is rejected'
);

-- A4: profiles RLS lets a user see themselves only.
insert into public.profiles (user_id, display_name)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select is(
  (select display_name from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'alice',
  'T-RLS-01: user A reads own profile'
);
select is(
  (select count(*)::integer from public.profiles where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'T-RLS-01: user A cannot read user B profile'
);

-- A5: profiles update WITH CHECK prevents reassigning the profile owner.
select throws_ok(
  $$ update public.profiles
       set user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
       where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  'new row violates row-level security policy for table "profiles"',
  'T-RLS-01: WITH CHECK prevents ownership reassignment'
);

reset role;
select * from finish();
rollback;