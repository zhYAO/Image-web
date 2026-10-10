-- Isolated migrated database only. No provider, Storage or real user calls.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('private','unknown_generation_health_receipts','unknown health has durable receipts');
select has_function('private','record_unknown_generation_health_once',array['uuid','text'],'unknown sampling helper exists');
select ok(not has_table_privilege('authenticated','private.unknown_generation_health_receipts','select'),'browser cannot read receipts');
select ok(not has_table_privilege('service_role','private.unknown_generation_health_receipts','insert'),'service role cannot directly invent receipts');
select ok(not has_function_privilege('authenticated','private.record_unknown_generation_health_once(uuid,text)','execute'),'browser cannot sample health');
select ok(not has_function_privilege('service_role','private.record_unknown_generation_health_once(uuid,text)','execute'),'service caller must use fenced worker RPC');

create temporary table health_before as
select coalesce(sum(total_count),0)::bigint total, coalesce(sum(error_count),0)::bigint errors
from private.provider_health_windows where provider='health-once-fixture';

select ok(private.record_unknown_generation_health_once('a6000000-0000-4000-8000-000000000001','health-once-fixture'),'first unknown is sampled');
select ok(not private.record_unknown_generation_health_once('a6000000-0000-4000-8000-000000000001','health-once-fixture'),'RPC replay is not sampled');
select ok(not private.record_unknown_generation_health_once('a6000000-0000-4000-8000-000000000001','different-provider-fixture'),'same generation cannot sample twice across provider arguments');
select is((select count(*) from private.unknown_generation_health_receipts where generation_id='a6000000-0000-4000-8000-000000000001'),1::bigint,'one durable receipt per generation');
select is((select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='health-once-fixture')-(select total from health_before),1::bigint,'one total sample');
select is((select coalesce(sum(error_count),0)::bigint from private.provider_health_windows where provider='health-once-fixture')-(select errors from health_before),1::bigint,'one error sample');
select is((select count(*) from private.provider_health_windows where provider='different-provider-fixture'),0::bigint,'replay does not touch another provider window');

-- A surrounding SQL failure rolls back the receipt and window together. This
-- executes the real helper, not a replacement function or mocked counter.
do $$
begin
  begin
    perform private.record_unknown_generation_health_once('a6000000-0000-4000-8000-000000000002','health-once-fixture');
    raise exception using errcode='ZX001',message='synthetic rollback';
  exception when sqlstate 'ZX001' then null;
  end;
end;
$$;
select is((select count(*) from private.unknown_generation_health_receipts where generation_id='a6000000-0000-4000-8000-000000000002'),0::bigint,'failed transaction retains no receipt');
select is((select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='health-once-fixture')-(select total from health_before),1::bigint,'failed transaction retains no sample');
select ok(private.record_unknown_generation_health_once('a6000000-0000-4000-8000-000000000002','health-once-fixture'),'retry after rollback samples once');
select is((select coalesce(sum(total_count),0)::bigint from private.provider_health_windows where provider='health-once-fixture')-(select total from health_before),2::bigint,'two distinct committed unknowns have two samples');
select is((select coalesce(sum(error_count),0)::bigint from private.provider_health_windows where provider='health-once-fixture')-(select errors from health_before),2::bigint,'each unknown increments the error count');

select * from finish();
rollback;
