-- The progress RPC is callable only by service_role. Its aggregate joins use
-- commerce_runs and commerce_run_items, which intentionally have no direct
-- SELECT grant for service_role. Execute those reads with the function owner.
alter function public.get_creative_batch_progress(uuid, uuid) security definer;
