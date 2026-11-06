-- Read-only preflight only. Never apply M6/M8 again and never enable pricing here.
begin read only;
select clock_timestamp() as checked_at,pg_database_size(current_database()) as database_bytes;
select version,name from supabase_migrations.schema_migrations where version>='20261105' order by version;
select model,enabled,version from private.chat_usage_settings order by model;
select count(*) as chat_rate_versions from private.chat_usage_versions;
select enabled,cost_version,sale_version from private.commerce_package_settings where singleton;
select (select count(*) from private.commerce_package_cost_versions) as package_cost_versions,(select count(*) from private.commerce_package_sale_versions) as package_sale_versions;
select coalesce(tariff->>'meteringVersion','legacy') as frozen_profile,settled,count(*) from private.chat_usage_operations group by 1,2;
select count(*) as new_profile_versions from private.chat_usage_versions where tariff->>'meteringVersion' in ('2','3');
select status,count(*) from private.credit_operations where operation='chat' group by status;
select 'openai' as provider,status,count(*) from private.openai_chat_calls group by status union all select 'doubao',status,count(*) from private.doubao_chat_calls group by status;
-- Stop before new Edge/configuration if any unclassified active/frozen/claimed old operation exists.
select n.nspname||'.'||p.proname as name,pg_get_function_identity_arguments(p.oid) as args,md5(pg_get_functiondef(p.oid)) as definition_md5,r.rolname as owner,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where (n.nspname='private' and p.proname in ('chat_usage_config','chat_usage_cap','chat_usage_amount')) or (n.nspname='public' and p.proname in ('credit_dispatch','openai_chat_relay','doubao_chat_relay')) order by 1;
select c.state,a.slot,a.state as attempt_state from private.provider_diagnostic_campaigns c left join private.provider_diagnostic_attempts a on a.campaign_id=c.id order by c.approved_at,a.slot;
commit;
