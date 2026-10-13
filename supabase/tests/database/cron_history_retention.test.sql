begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(27);

-- Entire transaction uses only disposable synthetic Cron jobs/history.
insert into cron.job(jobid, schedule, command, nodename, nodeport, database, username, active, jobname)
values (990001, '* * * * *', 'select 1', 'localhost', 5432, current_database(), current_user, false, 'retention-fixture');
insert into cron.job_run_details(jobid,runid,status,start_time,end_time,command) values
(990001,990001,'succeeded',now()-interval '20 days',now()-interval '20 days','synthetic-sensitive-command'),
(990001,990002,'failed',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command'),
(990001,990003,'running',now()-interval '40 days',null,'synthetic-sensitive-command'),
(990001,990004,'unknown',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command'),
(990001,990005,'succeeded',now()-interval '2 days',now()-interval '2 days','synthetic-sensitive-command'),
(990001,990006,'succeeded',now()-interval '40 days',null,'synthetic-sensitive-command'),
(990002,990007,'succeeded',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command');

select has_function('private','prune_approved_cron_history',array['bigint[]','bigint[]','timestamp with time zone','timestamp with time zone','integer','text'],'approved cleanup exists');
select ok(not has_function_privilege('anon','private.prune_approved_cron_history(bigint[],bigint[],timestamptz,timestamptz,integer,text)','EXECUTE'),'anon cannot prune');
select ok(not has_function_privilege('authenticated','private.prune_approved_cron_history(bigint[],bigint[],timestamptz,timestamptz,integer,text)','EXECUTE'),'users cannot prune');
select ok(not has_function_privilege('service_role','private.prune_approved_cron_history(bigint[],bigint[],timestamptz,timestamptz,integer,text)','EXECUTE'),'service role cannot prune');
select ok(not (select prosecdef from pg_proc where oid='private.prune_approved_cron_history(bigint[],bigint[],timestamptz,timestamptz,integer,text)'::regprocedure),'invoker privileges only');
select ok(not has_table_privilege('anon','private.cron_history_archive','SELECT,INSERT,UPDATE,DELETE'),'anon cannot read or alter archive');
select ok(not has_table_privilege('authenticated','private.cron_history_archive','SELECT,INSERT,UPDATE,DELETE'),'users cannot read or alter archive');
select ok(not has_table_privilege('service_role','private.cron_history_archive','SELECT,INSERT,UPDATE,DELETE'),'service role cannot read or alter archive');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='private.prune_approved_cron_history(bigint[],bigint[],timestamptz,timestamptz,integer,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC default execute revoked');
select throws_ok($$select private.prune_approved_cron_history('{}','{990001}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'22023','invalid_cron_retention_approval','empty job whitelist rejected');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001}',now()-interval '13 days',now()-interval '30 days',1,'approval-test')$$,'22023','invalid_cron_retention_approval','success window enforced');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001}',now()-interval '14 days',now()-interval '29 days',1,'approval-test')$$,'22023','invalid_cron_retention_approval','failure window enforced');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001,990002}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'22023','invalid_cron_retention_approval','approved exact count enforced');
select throws_ok($$select private.prune_approved_cron_history('{990001}',array(select generate_series(1,501)::bigint),now()-interval '14 days',now()-interval '30 days',501,'approval-test')$$,'22023','invalid_cron_retention_approval','500-row batch bound enforced');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001,990001}',now()-interval '14 days',now()-interval '30 days',2,'approval-test')$$,'22023','invalid_cron_retention_approval','duplicate IDs rejected');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001}',now()-interval '14 days',now()-interval '30 days',1,'')$$,'22023','invalid_cron_retention_approval','explicit approval reference required');
select throws_ok($$select private.prune_approved_cron_history('{990002}','{990007}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'22023','cron_retention_scope_changed','retired unmapped job excluded');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990007}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'22023','cron_retention_scope_changed','other job rows cannot enter approved scope');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990003,990004,990005,990006}',now()-interval '14 days',now()-interval '30 days',4,'approval-test')$$,'22023','cron_retention_scope_changed','running/unknown/recent/incomplete excluded');

-- Force archive failure: original rows must remain in the same transaction.
create function pg_temp.reject_archive() returns trigger language plpgsql as $$begin raise exception 'archive_fixture_failure'; end$$;
create trigger fixture_archive_failure before insert on private.cron_history_archive for each row execute function pg_temp.reject_archive();
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990001}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'P0001','archive_fixture_failure','archive error aborts cleanup');
select is((select count(*) from cron.job_run_details where runid=990001),1::bigint,'original retained on archive failure');
drop trigger fixture_archive_failure on private.cron_history_archive;
select is(private.prune_approved_cron_history('{990001}','{990001,990002}',now()-interval '14 days',now()-interval '30 days',2,'approval-test'),2,'deletes exactly two approved terminal rows');
select is((select count(*) from cron.job_run_details where runid between 990003 and 990007),5::bigint,'unapproved and excluded rows retained');
select is((select count(*) from private.cron_history_archive where runid in (990001,990002)),2::bigint,'whitelist metadata archived');
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name='cron_history_archive' and column_name in ('command','return_message')),'archive excludes credential-bearing fields');
insert into private.cron_history_archive(runid,jobid,status,end_time,approval_reference)
select 1000000+n,990001,'succeeded',now()-interval '40 days','capacity-fixture' from generate_series(1,99998) n;
insert into cron.job_run_details(jobid,runid,status,end_time) values(990001,990008,'succeeded',now()-interval '40 days');
select throws_ok($$select private.prune_approved_cron_history('{990001}','{990008}',now()-interval '14 days',now()-interval '30 days',1,'approval-test')$$,'54000','cron_archive_capacity_exceeded','archive capacity requires external review');
select is((select count(*) from cron.job_run_details where runid=990008),1::bigint,'archive capacity failure preserves original');
select * from finish();
rollback;
