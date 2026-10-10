-- Stop new dedicated batch create/submit ticks. Shared generation and cleanup
-- workers continue settling existing runs; retain all historical tables/RPCs.
select public.unschedule_creative_batch_worker();
