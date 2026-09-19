begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select ok(exists(select 1 from pg_indexes where schemaname = 'private' and indexname = 'image_safety_audits_generation_id_idx'));
select ok(exists(select 1 from pg_indexes where schemaname = 'private' and indexname = 'quota_ledger_batch_id_idx'));
select ok(exists(select 1 from pg_indexes where schemaname = 'private' and indexname = 'quota_ledger_generation_id_idx'));
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'generation_batches_parent_batch_id_idx'));
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'timeline_items_batch_session_idx'));
select ok(
  exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'provider_runtime_config'),
  'provider runtime configuration has an explicit private policy'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'runtime_flags'),
  'runtime flags have an explicit private policy'
);
select ok(
  exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'preview_usage_ledger'),
  'preview usage ledger has an explicit private policy'
);

select * from finish();
rollback;
