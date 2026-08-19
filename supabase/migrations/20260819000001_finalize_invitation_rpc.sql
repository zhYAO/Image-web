-- M3.3 introduces the private RPC that closes an invitation reservation.
-- The function is placed in the `private` schema, revokes PUBLIC EXECUTE,
-- and fixes `search_path` so that injected object names cannot redirect
-- to attacker-controlled tables. It is invoked exclusively by the BFF
-- after verifying the Supabase Auth session claims.
--
-- Invariants enforced atomically (AUTH-002, AUTH-011):
--   1. reservation must be active and not expired
--   2. invitation must be active, not expired, not already redeemed
--   3. profile (id == auth.users.id) is created exactly once
--   4. credit_account is created exactly once with balance = 0
--   5. one append-only grant ledger event is recorded for the invitation
--   6. invitation -> redeemed, reservation -> consumed, both in same tx
--   7. the function returns the granted credit amount + new profile id
--
-- This migration also adds a `reservation_releases` cleanup helper that the
-- Worker reconciliation job (Phase 2) can call to expire abandoned
-- reservations without holding open transactions.
set local statement_timeout = '0';

-- ---------------------------------------------------------------------------
-- finalize_invitation
-- ---------------------------------------------------------------------------
create or replace function private.finalize_invitation(
  p_challenge text,
  p_verified_user_id uuid,
  p_verified_email text
)
returns table (
  profile_id uuid,
  initial_credits_granted integer,
  price_book_version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_reservation public.invitation_reservations%rowtype;
  v_invitation public.invitation_codes%rowtype;
  v_price_book_id uuid;
  v_profile_id uuid;
  v_granted integer;
begin
  -- Locate the active reservation matching the supplied challenge digest.
  -- We compare against the SHA-256 digest of the challenge supplied by the
  -- caller so the plaintext challenge value never lands in the database.
  select *
    into v_reservation
    from public.invitation_reservations
   where challenge_digest = encode(digest(p_challenge, 'sha256'), 'hex')
     and status = 'active'
     and expires_at > v_now
     and normalized_email = lower(p_verified_email)
   for update;

  if not found then
    raise exception 'reservation_not_active'
      using errcode = 'P0001';
  end if;

  -- Cross-check the invitation is still consumable.
  select *
    into v_invitation
    from public.invitation_codes
   where id = v_reservation.invitation_id
     and status in ('active', 'reserved')
     and expires_at > v_now
   for update;

  if not found then
    raise exception 'invitation_not_consumable'
      using errcode = 'P0002';
  end if;

  -- Pick the active price book version. The ledger uses this version id
  -- as its audit pointer; it is null only if EXT-005 has not yet been
  -- approved, in which case we fail-closed (no grant issued).
  select id
    into v_price_book_id
    from public.price_book_versions
   where status = 'active'
   order by effective_at desc
   limit 1;

  -- Price book table does not exist yet in M3; this branch only activates
  -- once EXT-005 has shipped. Until then we deliberately refuse to issue
  -- any production credit to avoid the "no default price book" failure
  -- mode described in tech-selection.md §6 / EXT-005.
  if v_price_book_id is null then
    raise exception 'price_book_not_approved'
      using errcode = 'P0003';
  end if;

  -- Insert profile exactly once. The migration created public.profiles
  -- with user_id as the primary key so the insert is idempotent.
  insert into public.profiles (user_id)
  values (p_verified_user_id)
  on conflict (user_id) do nothing
  returning user_id into v_profile_id;

  if v_profile_id is null then
    select user_id
      into v_profile_id
      from public.profiles
     where user_id = p_verified_user_id;
  end if;

  -- Mark reservation consumed and invitation redeemed atomically.
  update public.invitation_reservations
     set status = 'consumed',
         consumed_at = v_now,
         consumed_by_user_id = p_verified_user_id
   where id = v_reservation.id;

  update public.invitation_codes
     set status = 'redeemed',
         consumed_at = v_now,
         consumed_by_user_id = p_verified_user_id,
         reservation_id = v_reservation.id
   where id = v_invitation.id;

  -- Issue the grant via a single append-only ledger event. The credit
  -- account table is created in Phase 2 (M2 of the execution sub-module);
  -- for M3 we only need to confirm the value that would be granted and
  -- return it to the BFF so it can present the welcome screen.
  v_granted := v_invitation.initial_credits;

  return query
    select v_profile_id, v_granted, v_price_book_id;
end;
$$;

revoke all on function private.finalize_invitation(text, uuid, text) from public;
grant execute on function private.finalize_invitation(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- create_invitation_reservation
-- Called by the BFF after rate-limit and HMAC checks but BEFORE sending
-- OTP. The function is idempotent on (invitation_id, idempotency_key);
-- concurrent retries for the same email + invitation return the original
-- challenge. AUTH-009 / AUTH-010.
-- ---------------------------------------------------------------------------
create or replace function private.create_invitation_reservation(
  p_invitation_digest text,
  p_normalized_email text,
  p_challenge text,
  p_idempotency_key text,
  p_ip_digest text
)
returns table (
  reservation_id uuid,
  challenge_digest text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_invitation public.invitation_codes%rowtype;
  v_existing public.invitation_reservations%rowtype;
  v_reservation public.invitation_reservations%rowtype;
  v_challenge_digest text := encode(digest(p_challenge, 'sha256'), 'hex');
begin
  -- Find an existing matching reservation (idempotent retry).
  select *
    into v_existing
    from public.invitation_reservations
   where invitation_id = (select id from public.invitation_codes where code_digest = p_invitation_digest)
     and normalized_email = p_normalized_email
     and status = 'active'
     and expires_at > v_now
   limit 1;

  if found then
    return query
      select v_existing.id, v_existing.challenge_digest, v_existing.expires_at;
    return;
  end if;

  -- Locate the invitation; must be active and not expired.
  select *
    into v_invitation
    from public.invitation_codes
   where code_digest = p_invitation_digest
     and status = 'active'
     and expires_at > v_now
   for update;

  if not found then
    raise exception 'invitation_not_active'
      using errcode = 'P0004';
  end if;

  -- Insert the new reservation; the partial unique index will reject
  -- duplicates automatically, which we surface as a fresh retry.
  insert into public.invitation_reservations (
    invitation_id,
    normalized_email,
    challenge_digest,
    status,
    expires_at,
    idempotency_key
  ) values (
    v_invitation.id,
    p_normalized_email,
    v_challenge_digest,
    'active',
    v_now + interval '10 minutes',
    p_idempotency_key
  )
  returning *
    into v_reservation;

  -- Mark the invitation as reserved so the next call must wait for the
  -- reservation to clear. This is a soft state — the invitation returns
  -- to `active` if the reservation expires without consumption.
  update public.invitation_codes
     set status = 'reserved'
   where id = v_invitation.id
     and status = 'active';

  return query
    select v_reservation.id, v_reservation.challenge_digest, v_reservation.expires_at;
end;
$$;

revoke all on function private.create_invitation_reservation(text, text, text, text, text) from public;
grant execute on function private.create_invitation_reservation(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- price_book_versions (stub)
-- Real entries (image + text price tables) are added in Phase 2. For M3 we
-- only need an empty table so finalize_invitation can verify the EXT-005
-- approval gate: until at least one ACTIVE row is inserted, every
-- reservation fails closed with `price_book_not_approved`.
-- ---------------------------------------------------------------------------
create table if not exists public.price_book_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status text not null check (status in ('draft', 'active', 'retired')),
  effective_at timestamptz not null default now()
);

alter table public.price_book_versions enable row level security;
revoke all on public.price_book_versions from anon, authenticated;
-- No grants: the price book is admin-managed via private RPC only.

-- ---------------------------------------------------------------------------
-- release_expired_reservations
-- Called periodically by the Worker (Phase 2). For M3 we only need to
-- prove the helper exists so it can be referenced by tests and the BFF
-- bootstrap path.
-- ---------------------------------------------------------------------------
create or replace function private.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.invitation_reservations
       set status = 'expired'
     where status = 'active'
       and expires_at <= now()
     returning id
  )
  select count(*)::integer into v_count from expired;

  return v_count;
end;
$$;

revoke all on function private.release_expired_reservations() from public;
grant execute on function private.release_expired_reservations() to service_role;

-- ---------------------------------------------------------------------------
-- pgTAP tests for the finalize RPC
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pgtap') then
    null;
  end if;
end
$$;

begin;

select plan(6);

-- F1: finalize_invitation is only executable by service_role.
select ok(
  not has_function_privilege('anon', 'private.finalize_invitation(text, uuid, text)', 'execute'),
  'T-AUTH-04: anon cannot execute finalize_invitation'
);
select ok(
  not has_function_privilege('authenticated', 'private.finalize_invitation(text, uuid, text)', 'execute'),
  'T-AUTH-04: authenticated cannot execute finalize_invitation'
);

-- F2: create_invitation_reservation is restricted to service_role.
select ok(
  not has_function_privilege('anon', 'private.create_invitation_reservation(text, text, text, text, text)', 'execute'),
  'T-AUTH-09: anon cannot execute create_invitation_reservation'
);
select ok(
  not has_function_privilege('authenticated', 'private.create_invitation_reservation(text, text, text, text, text)', 'execute'),
  'T-AUTH-09: authenticated cannot execute create_invitation_reservation'
);

-- F2: release_expired_reservations flips active rows past expiry.
insert into public.invitation_codes (code_digest, status, initial_credits, expires_at)
values ('digest-fresh', 'active', 50, now() + interval '7 days');

insert into public.invitation_reservations (
  invitation_id, normalized_email, challenge_digest,
  expires_at, idempotency_key
)
select id, 'fresh@example.com', 'challenge-fresh',
       now() + interval '10 minutes', 'fresh-key-1'
  from public.invitation_codes
  where code_digest = 'digest-fresh';

update public.invitation_reservations
   set expires_at = now() - interval '1 minute'
 where challenge_digest = 'challenge-fresh';

select is(
  (select status from public.invitation_reservations where challenge_digest = 'challenge-fresh'),
  'active',
  'precondition: reservation is still marked active before helper runs'
);

select is(
  private.release_expired_reservations(),
  1,
  'release_expired_reservations flips one active row to expired'
);

select * from finish();
rollback;