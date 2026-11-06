-- Only nonsecret configuration and hashes, no wallet/customer rows.
select jsonb_build_object(
 'creditSettings',(select to_jsonb(s)from private.credit_settings s where singleton),
 'creditVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.credit_price_versions v),
 'packageSettings',(select to_jsonb(s)from private.commerce_package_settings s where singleton),
 'packageCostVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.commerce_package_cost_versions v),
 'packageSaleVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.commerce_package_sale_versions v),
 'providerFlags',(select jsonb_agg(jsonb_build_object('provider',provider,'enabled',enabled)order by provider)from private.provider_runtime_config),
 'runtimeFlags',(select jsonb_agg(jsonb_build_object('flag',flag,'enabled',enabled)order by flag)from private.runtime_flags)
)as nonsecret_pricing_contract;
