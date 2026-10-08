-- Old page code omits next_attempt_at while the compatible backend is rolling out.
alter table public.creative_batches alter column next_attempt_at set default clock_timestamp();
