create index image_safety_audits_generation_id_idx
on private.image_safety_audits (generation_id);

create index quota_ledger_batch_id_idx
on private.quota_ledger (batch_id);

create index quota_ledger_generation_id_idx
on private.quota_ledger (generation_id);

create index generation_batches_parent_batch_id_idx
on public.generation_batches (parent_batch_id);

create index timeline_items_batch_session_idx
on public.timeline_items (batch_id, session_id);

create policy provider_runtime_config_service_only
on private.provider_runtime_config
for all
to service_role
using (true)
with check (true);

create policy runtime_flags_service_only
on private.runtime_flags
for all
to service_role
using (true)
with check (true);

create policy preview_usage_ledger_service_only
on private.preview_usage_ledger
for all
to service_role
using (true)
with check (true);
