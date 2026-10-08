begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(not has_function_privilege('authenticated',
  'public.claim_creative_batch_work(uuid,uuid)', 'execute'),
  'browser roles cannot claim batch work');
select ok(not has_function_privilege('anon',
  'public.checkpoint_creative_batch_work(uuid,uuid,jsonb,timestamptz,boolean)', 'execute'),
  'anonymous callers cannot checkpoint batch work');
select ok(has_function_privilege('service_role',
  'public.claim_creative_batch_work(uuid,uuid)', 'execute'),
  'service role can claim batch work');

create temp table batch_fixture(owner_id uuid, session_id uuid, batch_id uuid);
do $$
declare owner_id uuid := gen_random_uuid(); session_id uuid := gen_random_uuid();
  batch_id uuid := gen_random_uuid();
begin
  insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values(owner_id, owner_id::text || '@batch.test', now(), false);
  insert into public.sessions(id,user_id,title) values(session_id,owner_id,'Batch worker test');
  insert into public.creative_batches(id,user_id,session_id,request_id,request_hash,
    workflow,items,next_attempt_at)
    values(batch_id,owner_id,session_id,gen_random_uuid(),'test','product-set',
      jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),
        'status','pending','submitRequestId',gen_random_uuid())),clock_timestamp());
  insert into batch_fixture values(owner_id,session_id,batch_id);
end $$;

select is((select count(*)::int from public.claim_creative_batch_work(
    (select batch_id from batch_fixture), (select owner_id from batch_fixture))), 1,
  'first due claim gets one batch');
select is((select count(*)::int from public.claim_creative_batch_work(
    (select batch_id from batch_fixture), (select owner_id from batch_fixture))), 0,
  'second claim cannot steal an active lease');
select is((select count(*)::int from public.checkpoint_creative_batch_work(
    (select batch_id from batch_fixture), gen_random_uuid(),
    (select items from public.creative_batches where id=(select batch_id from batch_fixture)),
    null, true)), 0, 'wrong token cannot overwrite work');
update public.creative_batches set lease_until = clock_timestamp() - interval '1 second'
  where id = (select batch_id from batch_fixture);
select is((select count(*)::int from public.checkpoint_creative_batch_work(
    (select batch_id from batch_fixture),
    (select lease_token from public.creative_batches where id=(select batch_id from batch_fixture)),
    (select items from public.creative_batches where id=(select batch_id from batch_fixture)),
    null, true)), 0, 'expired lease cannot checkpoint');
select is((select count(*)::int from public.claim_creative_batch_work(
    (select batch_id from batch_fixture), (select owner_id from batch_fixture))), 1,
  'expired lease can be reclaimed');
select is((select count(*)::int from public.checkpoint_creative_batch_work(
    (select batch_id from batch_fixture),
    (select lease_token from public.creative_batches where id=(select batch_id from batch_fixture)),
    (select jsonb_set(items,'{0,status}','"submitted"'::jsonb)
      from public.creative_batches where id=(select batch_id from batch_fixture)),
    null, true)), 1, 'valid token checkpoints and releases');
select is((select count(*)::int from public.claim_creative_batch_work(
    (select batch_id from batch_fixture), (select owner_id from batch_fixture))), 0,
  'completed batch cannot be claimed again');
select is(public.get_creative_batch_progress(
    (select batch_id from batch_fixture), gen_random_uuid()), null::jsonb,
  'progress denies a different owner');

select * from finish();
rollback;
