-- Phase 1B: make `config.enabled` the authoritative gate for chat providers.
-- Once an operator has explicitly enabled a provider through
-- set_provider_runtime_enabled, recent health windows no longer veto
-- submission. They stay informational (downgraded to `degraded`) so the UI
-- can still surface "recent errors" warnings, but the assert / health
-- functions stop returning `unavailable` purely because of stale failure
-- records. Operators retain the ability to flip `config.enabled` back to
-- false (via private.set_provider_runtime_enabled) if a provider must be
-- taken offline.

-- Existing projects already ran phase1_preview_guards with MiniMax disabled.
-- Backfill the runtime row here so upgrading projects receive the same
-- enabled default as fresh databases, which now create that row as enabled.
select private.set_provider_runtime_enabled(
  'minimax',
  true,
  'minimax_m2_7_api_key_and_model_verified_20260825'
);

create or replace function public.assert_chat_provider_available(p_provider text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce((
    select config.enabled
    from private.provider_runtime_config config
    where config.provider = p_provider
  ), false);
$$;

create or replace function private.get_provider_health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (provider) provider, state, updated_at
    from private.provider_health_windows
    where window_start >= timezone('utc', now()) - interval '10 minutes'
    order by provider, window_start desc
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'provider', config.provider,
    'status', case
      when not config.enabled then 'unavailable'
      when latest.provider is null then 'degraded'
      when latest.state in ('warning', 'unavailable') then 'degraded'
      else 'healthy'
    end,
    'checkedAt', coalesce(latest.updated_at, config.updated_at),
    'message', case
      when not config.enabled then '严格零费用模式下尚未验证可用额度，服务保持关闭。'
      when latest.state = 'warning' then '近期错误率升高，提交前请确认。'
      when latest.state = 'unavailable' then 'provider 已显式启用，近期失败仅作提示，可继续提交。'
      when latest.provider is null then '尚无近期运行样本，请在提交前确认。'
      else null
    end
  )) order by config.provider), '[]'::jsonb)
  from private.provider_runtime_config config
  left join latest using (provider);
$$;
