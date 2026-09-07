begin;
create extension if not exists pgtap with schema extensions;
select plan(24);
select has_table('public','account_profiles','formal account profiles exist');
select has_table('private','auth_rate_limits','database-backed auth limiter exists');
select has_table('private','account_cleanup_jobs','idempotent account cleanup queue exists');
select has_function('public','require_verified_user_id',array[]::text[],'live-session guard exists');
select has_function('public','consume_auth_rate_limit',array['text','text','text','integer','integer','integer'],'atomic limiter exists');
select ok(not has_table_privilege('anon','public.account_profiles','select'),'anonymous role cannot read profiles');
select ok(has_column_privilege('authenticated','public.account_profiles','display_name','update'),'owner may update display name');
select ok(not has_column_privilege('authenticated','public.account_profiles','status','update'),'client cannot update status');
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('00000000-0000-0000-0000-0000000000a1','a@example.com',timezone('utc',now()),false),
 ('00000000-0000-0000-0000-0000000000b2','b@example.com',timezone('utc',now()),false),
 ('00000000-0000-0000-0000-0000000000c3','c@example.com',null,false),
 ('00000000-0000-0000-0000-0000000000d4',null,null,true);
insert into auth.sessions(id,user_id) values
 ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1'),
 ('10000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2'),
 ('10000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000c3'),
 ('10000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000d4');
insert into public.sessions(id,user_id,title) values
 ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','a'),
 ('20000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2','b');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","session_id":"10000000-0000-0000-0000-0000000000a1"}',true);
select is(public.require_verified_user_id(),'00000000-0000-0000-0000-0000000000a1'::uuid,'verified live session passes');
select results_eq($$select count(*)::bigint from public.sessions$$,array[1::bigint],'RLS hides another account');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","session_id":"10000000-0000-0000-0000-000000000099"}',true);
select throws_ok($$select public.require_verified_user_id()$$,'P0001','unauthorized','old token is rejected');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated","session_id":"10000000-0000-0000-0000-0000000000c3"}',true);
select throws_ok($$select public.require_verified_user_id()$$,'P0001','unauthorized','unverified email is rejected');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated","session_id":"10000000-0000-0000-0000-0000000000d4"}',true);
select throws_ok($$select public.require_verified_user_id()$$,'P0001','unauthorized','anonymous identity is rejected');
reset role;
select is((public.consume_auth_rate_limit('login','email-a','ip-a',2,900,900)->>'allowed')::boolean,true,'first request passes');
select is((public.consume_auth_rate_limit('login','email-a','ip-a',2,900,900)->>'allowed')::boolean,true,'second request passes');
select is((public.consume_auth_rate_limit('login','email-a','ip-a',2,900,900)->>'allowed')::boolean,false,'next request is blocked');
select is((public.consume_auth_rate_limit('login','email-a','ip-b',2,900,900)->>'allowed')::boolean,true,'different IP is not locked');
select throws_ok($$select public.consume_auth_rate_limit('login','','ip',2,900,0)$$,'22023','invalid rate limit input','empty hash rejected');
select throws_ok($$select public.consume_auth_rate_limit('login','email','ip',2,900,-1)$$,'22023','invalid rate limit input','negative block rejected');
update private.auth_rate_limits set window_started_at=timezone('utc',now())-interval '901 seconds',blocked_until=timezone('utc',now())-interval '1 second' where action='login' and email_hash='email-a' and ip_hash='ip-a';
select is((public.consume_auth_rate_limit('login','email-a','ip-a',2,900,900)->>'allowed')::boolean,true,'expired window resets atomically');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","session_id":"10000000-0000-0000-0000-0000000000a1"}',true);
select ok(public.request_account_deletion(),'first deletion accepted');
select ok(public.request_account_deletion(),'duplicate deletion is idempotent');
select throws_ok($$select public.require_verified_user_id()$$,'P0001','unauthorized','deleting account blocked immediately');
reset role;
select is((select count(*) from private.account_cleanup_jobs where user_id='00000000-0000-0000-0000-0000000000a1'),1::bigint,'duplicate deletion queues once');
select * from finish();
rollback;
