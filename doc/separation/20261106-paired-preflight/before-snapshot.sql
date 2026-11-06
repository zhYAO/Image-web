-- Read-only M5 snapshot. Fail if m6Present is true; not an attestation.
select jsonb_build_object('checkedAt',statement_timestamp(),'m6Present',to_regclass('private.chat_usage_settings')is not null,'vector',jsonb_build_object('schemaVersion',2,'projectRef','klmiycyesxnpinxpeqep','objects',(select contract_objects from (-- Read-only metadata only. No function bodies, secrets, user rows or DDL.
with wanted(signature)as(values
 ('public.chat_usage_dispatch(uuid,text,jsonb)'),('public.credit_dispatch(uuid,text,jsonb)'),
 ('private.credit_settle(uuid,text,text)'),('public.openai_chat_relay(uuid,uuid,text,text,text)'),
 ('public.doubao_chat_relay(uuid,uuid,text,text,text)'),('private.chat_usage_immutable()'),
 ('private.chat_usage_config(text)'),('private.chat_usage_cap(jsonb)'),
 ('private.chat_usage_amount(jsonb,bigint,jsonb)'),('private.preserve_image_usage_receipt()'),
 ('private.credit_dispatch_before_token(uuid,text,jsonb)'),('private.credit_settle_before_token(uuid,text,text)'),
 ('private.openai_chat_relay_before_token(uuid,uuid,text,text,text)'),('private.doubao_chat_relay_before_token(uuid,uuid,text,text,text)')),
 functions as(select w.signature,case when p.oid is null then null else jsonb_build_object(
 'sourceSha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
 'language',l.lanname,'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,
 'kind',p.prokind,'strict',p.proisstrict,'leakproof',p.proleakproof,'volatility',p.provolatile,'parallel',p.proparallel,
 'returnsSet',p.proretset,'returnType',format_type(p.prorettype,null),'argumentNames',p.proargnames,
 'argumentModes',p.proargmodes,'defaultArguments',pg_get_expr(p.proargdefaults,0),
 'configuration',coalesce((select jsonb_agg(v order by v)from unnest(p.proconfig)v),'[]'::jsonb),
 'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,
    'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
    order by a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type),'[]'::jsonb)
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a),
 'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
 'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
 'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'))end as value
 from wanted w left join pg_proc p on p.oid=to_regprocedure(w.signature)left join pg_language l on l.oid=p.prolang),
 relations(name)as(values('private.chat_usage_versions'),('private.chat_usage_settings'),('private.chat_usage_operations'),('private.image_usage_receipts')),
 tables as(select w.name,case when r.oid is null then null else jsonb_build_object(
 'owner',pg_get_userbyid(r.relowner),'kind',r.relkind,'persistence',r.relpersistence,
 'rowSecurity',r.relrowsecurity,'forceRowSecurity',r.relforcerowsecurity,'replicaIdentity',r.relreplident,
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))
   order by a.attnum),'[]'::jsonb)from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true),
   'deferrable',c.condeferrable,'initiallyDeferred',c.condeferred,'validated',c.convalidated)order by c.conname),'[]'::jsonb)from pg_constraint c where c.conrelid=r.oid),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_indexdef(i.indexrelid,0,true),
   'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary)order by c.relname),'[]'::jsonb)
   from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=r.oid),
 'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
   'roles',(select jsonb_agg(case when role=0 then 'PUBLIC'else pg_get_userbyid(role)end order by role=0,pg_get_userbyid(role))from unnest(p.polroles)role),
   'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))order by p.polname),'[]'::jsonb)
   from pg_policy p where p.polrelid=r.oid),
 'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,
   'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
   order by a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type),'[]'::jsonb)
   from aclexplode(coalesce(r.relacl,acldefault('r',r.relowner)))a))end as value
 from relations w left join pg_class r on r.oid=to_regclass(w.name)),
 triggers(relation,name)as(values('private.chat_usage_versions','chat_usage_version_immutable'),('private.generation_work','preserve_image_usage_receipt')),
 trigger_objects as(select w.relation||'.'||w.name as name,case when t.oid is null then null else jsonb_build_object(
   'definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred)end as value
   from triggers w left join pg_trigger t on t.tgrelid=to_regclass(w.relation)and t.tgname=w.name and not t.tgisinternal)
 select jsonb_build_object('functions',(select jsonb_object_agg(signature,value)from functions),
 'tables',(select jsonb_object_agg(name,value)from tables),'triggers',(select jsonb_object_agg(name,value)from trigger_objects))as contract_objects)o),'pricing',(select nonsecret_pricing_contract from (-- Only nonsecret configuration and hashes, no wallet/customer rows.
select jsonb_build_object(
 'creditSettings',(select to_jsonb(s)from private.credit_settings s where singleton),
 'creditVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.credit_price_versions v),
 'packageSettings',(select to_jsonb(s)from private.commerce_package_settings s where singleton),
 'packageCostVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.commerce_package_cost_versions v),
 'packageSaleVersionsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(v)order by v.version),'[]'::jsonb)::text,'UTF8')),'hex')from private.commerce_package_sale_versions v),
 'providerFlags',(select jsonb_agg(jsonb_build_object('provider',provider,'enabled',enabled)order by provider)from private.provider_runtime_config),
 'runtimeFlags',(select jsonb_agg(jsonb_build_object('flag',flag,'enabled',enabled)order by flag)from private.runtime_flags)
)as nonsecret_pricing_contract)p),'supplement',(select supplemental_objects from (-- Bounded read-only supplement. Copy M6:184's predicate EXACTLY, including
-- SQL LIKE wildcard behavior, and inventory overloads rather than assuming none.
with wanted(signature)as(values
 ('public.chat_usage_dispatch(uuid,text,jsonb)'),('public.credit_dispatch(uuid,text,jsonb)'),('private.credit_settle(uuid,text,text)'),
 ('public.openai_chat_relay(uuid,uuid,text,text,text)'),('public.doubao_chat_relay(uuid,uuid,text,text,text)'),
 ('private.chat_usage_immutable()'),('private.chat_usage_config(text)'),('private.chat_usage_cap(jsonb)'),
 ('private.chat_usage_amount(jsonb,bigint,jsonb)'),('private.preserve_image_usage_receipt()'),
 ('private.credit_dispatch_before_token(uuid,text,jsonb)'),('private.credit_settle_before_token(uuid,text,text)'),
 ('private.openai_chat_relay_before_token(uuid,uuid,text,text,text)'),('private.doubao_chat_relay_before_token(uuid,uuid,text,text,text)')),
 all_named as(select p.*,n.nspname,format('%I.%I(%s)',n.nspname,p.proname,oidvectortypes(p.proargtypes))as signature,
   exists(select 1 from wanted w where to_regprocedure(w.signature)=p.oid)as reviewed,
   n.nspname='private'and(p.proname like 'chat_usage_%'or p.proname in('credit_dispatch_before_token','credit_settle','credit_settle_before_token','openai_chat_relay_before_token','doubao_chat_relay_before_token'))as revoked
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where exists(select 1 from wanted w where n.nspname=split_part(w.signature,'.',1)and p.proname=split_part(split_part(w.signature,'.',2),'(',1))
    or(n.nspname='private'and(p.proname like 'chat_usage_%'or p.proname in('credit_dispatch_before_token','credit_settle','credit_settle_before_token','openai_chat_relay_before_token','doubao_chat_relay_before_token')))),
 inventory as(select signature,revoked,jsonb_build_object('signature',signature,'isReviewedSignature',reviewed,
   'owner',pg_get_userbyid(proowner),'sourceSha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),
   'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'else pg_get_userbyid(a.grantee)end,
   'privilege',a.privilege_type,'grantor',pg_get_userbyid(a.grantor),'grantable',a.is_grantable)order by a.grantee=0,pg_get_userbyid(a.grantee),a.privilege_type),'[]'::jsonb)
   from aclexplode(coalesce(all_named.proacl,acldefault('f',all_named.proowner)))a))as value from all_named),
 roles(name)as(values('anon'),('authenticated'),('service_role')),
 relations(name)as(values('private.chat_usage_versions'),('private.chat_usage_settings'),('private.chat_usage_operations'),('private.image_usage_receipts')),
 access as(select w.name,case when r.oid is null then null else jsonb_build_object(
   'effectiveAnyTablePrivilege',(select jsonb_object_agg(role.name,has_table_privilege(role.name,r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))from roles role),
   'columns',(select jsonb_object_agg(a.attname,jsonb_build_object(
    'explicitAcl',(select coalesce(jsonb_agg(jsonb_build_object('grantee',case when x.grantee=0 then 'PUBLIC'else pg_get_userbyid(x.grantee)end,
      'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable)order by x.grantee=0,pg_get_userbyid(x.grantee),x.privilege_type),'[]'::jsonb)
      from aclexplode(case when cardinality(a.attacl)>0 then a.attacl else null end)x),
    'effectiveAnyColumnPrivilege',(select jsonb_object_agg(role.name,has_column_privilege(role.name,r.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES'))from roles role)))
     from pg_attribute a where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped))end as value
   from relations w left join pg_class r on r.oid=to_regclass(w.name)),
 touched(name)as(select name from relations union all select 'private.generation_work'),
 triggers as(select w.name,case when to_regclass(w.name)is null then null else
   (select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),
     'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred)order by t.tgname),'[]'::jsonb)
    from pg_trigger t where t.tgrelid=to_regclass(w.name)and not t.tgisinternal)end as value from touched w)
select jsonb_build_object('exactPrivateRevokeScope',(select coalesce(jsonb_agg(value order by signature),'[]'::jsonb)from inventory where revoked),
 'affectedNameOverloads',(select coalesce(jsonb_agg(value order by signature),'[]'::jsonb)from inventory),
 'tableAndColumnAccess',(select jsonb_object_agg(name,value)from access),
 'allUserTriggersOnTouchedRelations',(select jsonb_object_agg(name,value)from triggers))as supplemental_objects)s),'migrations',(select jsonb_agg(jsonb_build_object('version',version,'name',name)order by version)from supabase_migrations.schema_migrations),'chatUsageConfiguration',jsonb_build_object('exists',false)))as snapshot;
