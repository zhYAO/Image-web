-- Historical batches remain available through live-login, owner/active-session
-- gateways. Keep their rows and service access; close the old stale-JWT read path.
revoke select on table public.creative_batches from authenticated;
