-- A dedicated upgrade harness seeds these legacy rows before the reliability
-- migration. Ordinary db-test runs skip when that pre-upgrade fixture is absent.
begin;
set local timezone='UTC';
create extension if not exists pgtap with schema extensions;
select plan(4);
create function pg_temp.check_legacy_upgrade() returns setof text language plpgsql as $$
declare result jsonb;
begin
  if not exists(select 1 from public.generation_batches where id='d3000000-0000-4000-8000-000000000001') then
    return query select skip('run with the documented pre-migration upgrade fixture',4); return;
  end if;
  result:=private.recreate_image_generation('d1000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
    'failed',null,'upgrade-retry','upgrade-retry',gen_random_uuid());
  return next is((select count(*) from public.generations where batch_id=(result->>'batchId')::uuid),1::bigint,
    'only confirmed rejection is recreated from a mixed pre-upgrade failed batch');
  return next is((select count(*) from private.quota_ledger where original_batch_id='d3000000-0000-4000-8000-000000000001' and entry_type='reserve'),3::bigint,
    'upgrade retains all three original reservations');
  return next is((select count(*) from private.generation_work where generation_id in (select id from public.generations where batch_id='d3000000-0000-4000-8000-000000000001')),0::bigint,
    'upgrade does not invent missing provider checkpoints');
  return next is((select count(*) from private.quota_ledger where batch_id=(result->>'batchId')::uuid and entry_type='reserve'),1::bigint,
    'ordinary failed-only retry buys just the confirmed rejection replacement');
end;
$$;
select * from pg_temp.check_legacy_upgrade();
select * from finish();
rollback;
