-- Bounded read-only supplement. Copy M6:184's predicate EXACTLY, including
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
 'allUserTriggersOnTouchedRelations',(select jsonb_object_agg(name,value)from triggers))as supplemental_objects;
