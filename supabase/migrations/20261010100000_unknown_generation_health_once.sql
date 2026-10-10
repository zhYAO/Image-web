-- Sample each newly unknown generation once, independently of credit settlement.
-- No content FK: cleanup must not erase an already recorded sample's identity.
create table private.unknown_generation_health_receipts (
  generation_id uuid primary key,
  provider text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.unknown_generation_health_receipts enable row level security;
revoke all on table private.unknown_generation_health_receipts
  from public, anon, authenticated, service_role;

create function private.record_unknown_generation_health_once(
  p_generation_id uuid,
  p_provider text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.unknown_generation_health_receipts(generation_id,provider)
    values(p_generation_id,p_provider)
    on conflict(generation_id) do nothing;
  if not found then return false; end if;
  -- Receipt and shared window commit or roll back in the caller's transaction.
  perform private.record_provider_result(p_provider,true);
  return true;
end;
$$;
revoke all on function private.record_unknown_generation_health_once(uuid,text)
  from public, anon, authenticated, service_role;
