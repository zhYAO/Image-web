begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

select has_table('private', 'provider_runtime_config', 'provider runtime configuration is private');
select has_table('private', 'runtime_flags', 'runtime flags are private');
select has_table('private', 'preview_usage_ledger', 'preview usage ledger is private');
select has_function(
  'public',
  'reserve_preview_usage',
  array['uuid', 'text', 'bigint', 'boolean', 'text', 'uuid'],
  'atomic preview reservation function exists'
);
select has_function(
  'public', 'commit_preview_usage', array['uuid', 'text'],
  'user-scoped reservation commit function exists'
);
select has_function(
  'public', 'release_preview_usage', array['uuid', 'text', 'uuid'],
  'owner-correlation reservation release function exists'
);
select has_function('public', 'prune_preview_usage', array[]::text[], 'bounded retention function exists');
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid)',
    'execute'
  ),
  'authenticated users cannot reserve usage directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_preview_usage(uuid,text,bigint,boolean,text,uuid)',
    'execute'
  ),
  'service role can reserve usage after server authorization'
);
select is(public.assert_chat_provider_available('doubao'), false, 'doubao chat provider still requires explicit enablement');
-- MiniMax ships pre-enabled so a configured MINIMAX_API_KEY +
-- ZIMAGE_MINIMAX_CHAT_MODEL pair works without manual SQL toggling.
select is(public.assert_chat_provider_available('minimax'), true, 'minimax chat provider is enabled by default in phase 1');
select is(
  (select item ->> 'status' from jsonb_array_elements(public.get_provider_health()) item where item ->> 'provider' = 'minimax'),
  'degraded',
  'the default-enabled minimax provider has no recent health sample, so it surfaces as degraded until the first run'
);

-- config.enabled is the authoritative gate. Once an operator has explicitly
-- enabled a provider, a stale `unavailable` health window must not veto
-- either the assert or the health-surface status. Both must stay `true` /
-- `degraded` regardless of recent failure records.
insert into private.provider_health_windows
  (provider, window_start, total_count, error_count, state)
values
  ('minimax', timezone('utc', now()), 10, 9, 'unavailable')
on conflict (provider, window_start) do update set state = excluded.state;
select is(
  public.assert_chat_provider_available('minimax'),
  true,
  'minimax stays assertable even with a recent unavailable health window because config.enabled is the gate'
);
select is(
  (select item ->> 'status' from jsonb_array_elements(public.get_provider_health()) item where item ->> 'provider' = 'minimax'),
  'degraded',
  'a stale unavailable window does not flip an enabled provider back to unavailable status'
);
select is(
  (select item ->> 'status' from jsonb_array_elements(public.get_provider_health()) item where item ->> 'provider' = 'gemini'),
  'unavailable',
  'disabled image providers are reported unavailable'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'preview_usage_ledger'
      and indexdef like '%(user_id, metric, created_at)%'
  ),
  'per-user usage windows have a composite index'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and tablename = 'preview_usage_ledger'
      and indexdef like '%(metric, created_at)%'
  ),
  'global usage windows have a composite index'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_provider_runtime_enabled(text,boolean,text)',
    'execute'
  ),
  'authenticated users cannot enable a provider'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.set_runtime_flag(text,boolean)',
    'execute'
  ),
  'service role owns the emergency runtime switch'
);

insert into auth.users (id)
values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000c3');

select lives_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000c1', 'upload', 52428800, false,
    'upload-first', '10000000-0000-0000-0000-0000000000c1'
  )$$,
  'the exact 50 MB user upload boundary is allowed'
);
select is(
  public.release_preview_usage(
    '00000000-0000-0000-0000-0000000000c1',
    'upload-first',
    '10000000-0000-0000-0000-0000000000c1'
  ),
  true,
  'a failed upload releases its reservation'
);
select lives_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000c1', 'upload', 52428800, false,
    'upload-after-release', '10000000-0000-0000-0000-0000000000c2'
  )$$,
  'released upload bytes no longer consume the daily limit'
);

do $$
begin
  for index in 1..10 loop
    perform public.reserve_preview_usage(
      '00000000-0000-0000-0000-0000000000c2', 'session_create', 0, true,
      'session-' || index::text, gen_random_uuid()
    );
  end loop;
end;
$$;
select throws_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000c2', 'session_create', 0, true,
    'session-eleven', '10000000-0000-0000-0000-0000000000c3'
  )$$,
  'P0001',
  'preview_quota_exceeded:session_day',
  'the eleventh UTC-day session is rejected'
);

do $$
begin
  for index in 1..60 loop
    perform public.reserve_preview_usage(
      '00000000-0000-0000-0000-0000000000c3', 'session_update', 0, false,
      'hour-write-' || index::text, gen_random_uuid()
    );
  end loop;
end;
$$;
select throws_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000c3', 'session_update', 0, false,
    'hour-write-61', '10000000-0000-0000-0000-0000000000c4'
  )$$,
  'P0001',
  'preview_quota_exceeded:write_hour',
  'the sixty-first hourly mutation is rejected'
);
select throws_ok(
  $$select public.reserve_preview_usage(
    '00000000-0000-0000-0000-0000000000c1', 'generation', 0, false,
    'generation-off', '10000000-0000-0000-0000-0000000000c5'
  )$$,
  'P0001',
  'feature_disabled:generation',
  'generation fails closed before any task is created'
);
select is(public.prune_preview_usage() >= 0, true, 'bounded usage cleanup is callable');

select * from finish();
rollback;
