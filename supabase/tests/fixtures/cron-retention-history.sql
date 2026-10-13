-- Run only as local CI supabase_admin after supabase start; never against production.
-- Inactive synthetic job; ordinary postgres owner sees it through native RLS.
insert into cron.job(jobid, schedule, command, nodename, nodeport, database, username, active, jobname)
values (990001, '* * * * *', 'select 1', 'localhost', 5432, current_database(), 'postgres', false, 'retention-fixture');
insert into cron.job_run_details(jobid,runid,username,status,start_time,end_time,command) values
(990001,990001,'postgres','succeeded',now()-interval '20 days',now()-interval '20 days','synthetic-sensitive-command'),
(990001,990002,'postgres','failed',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command'),
(990001,990003,'postgres','running',now()-interval '40 days',null,'synthetic-sensitive-command'),
(990001,990004,'postgres','unknown',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command'),
(990001,990005,'postgres','succeeded',now()-interval '2 days',now()-interval '2 days','synthetic-sensitive-command'),
(990001,990006,'postgres','succeeded',now()-interval '40 days',null,'synthetic-sensitive-command'),
(990002,990007,'postgres','succeeded',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command'),
(990001,990008,'postgres','succeeded',now()-interval '40 days',now()-interval '40 days','synthetic-sensitive-command');

