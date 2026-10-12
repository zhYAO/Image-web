-- A dedicated upgrade harness seeds these legacy rows before the reliability
-- migration. Ordinary db-test runs skip when that pre-upgrade fixture is absent.
begin;
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select plan(4);
create function pg_temp.check_legacy_upgrade() returns setof text language plpgsql as $$
declare before_batches bigint; before_reserves bigint;
begin
  if not exists(select 1 from public.generation_batches where id='d3000000-0000-4000-8000-000000000001') then
    return query select skip('run with the documented pre-migration upgrade fixture',4); return;
  end if;
  select count(*) into before_batches from public.generation_batches where user_id='d1000000-0000-4000-8000-000000000001';
  select count(*) into before_reserves from private.quota_ledger where user_id='d1000000-0000-4000-8000-000000000001' and entry_type='reserve';
  return next throws_ok($retry$select private.recreate_image_generation('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
    'failed',null,'upgrade-retry','upgrade-retry',gen_random_uuid())$retry$,'22023','image_model_upgrade_required',
    'legacy confirmed rejection cannot create new work with a retired model');
  return next is((select count(*) from private.quota_ledger where original_batch_id='d3000000-0000-4000-8000-000000000001' and entry_type='reserve'),3::bigint,
    'upgrade retains all three original reservations');
  return next is((select count(*) from private.generation_work where generation_id in (select id from public.generations where batch_id='d3000000-0000-4000-8000-000000000001')),0::bigint,
    'upgrade does not invent missing provider checkpoints');
  return next ok((select count(*) from public.generation_batches where user_id='d1000000-0000-4000-8000-000000000001')=before_batches
    and (select count(*) from private.quota_ledger where user_id='d1000000-0000-4000-8000-000000000001' and entry_type='reserve')=before_reserves,
    'rejected legacy recreation adds no new batch or quota reservation');
end;
$$;
select * from pg_temp.check_legacy_upgrade();
select * from finish();
rollback;
