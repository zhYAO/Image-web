begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_extension('pgmq', 'pgmq extension is installed');
select ok(
  exists (select 1 from pgmq.meta where queue_name = 'image_generation'),
  'durable image generation queue exists'
);
select ok(
  exists (
    select 1 from pg_proc join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'private' and pg_proc.proname = 'submit_image_generation'
  ),
  'private atomic submission function exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)',
    'execute'
  ),
  'authenticated cannot call privileged image submission directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.submit_image_generation(uuid,uuid,text,text,text,jsonb,text,uuid,text,text,text,text,uuid)',
    'execute'
  ),
  'service role can call image submission after server authorization'
);
select ok(not has_schema_privilege('authenticated', 'pgmq', 'usage'), 'authenticated cannot use pgmq internals');
select ok(not has_schema_privilege('authenticated', 'pgmq_public', 'usage'), 'authenticated cannot use queue API wrappers');
select has_function(
  'public',
  'claim_image_generation',
  array[]::text[],
  'worker claim function exists'
);
select has_function(
  'public',
  'mark_provider_submission_started',
  array['uuid'],
  'provider submission boundary exists'
);
select has_function(
  'public',
  'complete_image_generation',
  array['bigint', 'uuid', 'text', 'text'],
  'worker completion function exists'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_image_generation()', 'execute'),
  'authenticated cannot claim image work'
);
select ok(
  has_function_privilege('service_role', 'public.claim_image_generation()', 'execute'),
  'service role can claim image work'
);

select * from finish();
rollback;
