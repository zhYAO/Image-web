begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select has_function('public', 'claim_cleanup_job', array[]::text[], 'cleanup claim exists');
select has_function('public', 'complete_cleanup_job', array['uuid'], 'cleanup completion exists');
select has_function('public', 'fail_cleanup_job', array['uuid', 'text'], 'cleanup backoff exists');
select ok(not has_function_privilege('authenticated', 'public.claim_cleanup_job()', 'execute'), 'users cannot claim cleanup jobs');
select ok(has_function_privilege('service_role', 'public.claim_cleanup_job()', 'execute'), 'service role can claim cleanup jobs');
select matches(
  pg_get_functiondef('private.claim_cleanup_job()'::regprocedure),
  'status = ''processing''.*updated_at <=',
  'stale processing cleanup jobs can be reclaimed after the lease expires'
);
select * from finish();
rollback;
