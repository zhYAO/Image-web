begin;

select plan(7);

create table public.rls_owned_fixture (
  id uuid primary key,
  owner_id uuid not null,
  label text not null
);

create table public.rls_ungranted_fixture (
  id uuid primary key,
  owner_id uuid not null
);

alter table public.rls_owned_fixture enable row level security;
alter table public.rls_ungranted_fixture enable row level security;

revoke all on public.rls_owned_fixture from anon, authenticated;
revoke all on public.rls_ungranted_fixture from anon, authenticated;
grant select, update on public.rls_owned_fixture to authenticated;

create policy "owners can read their fixture rows"
on public.rls_owned_fixture
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "owners can update their fixture rows"
on public.rls_owned_fixture
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

insert into public.rls_owned_fixture (id, owner_id, label)
values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user-a'),
  ('20000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'user-b');

select ok(
  has_table_privilege('authenticated', 'public.rls_owned_fixture', 'select'),
  'authenticated receives the explicit table grant'
);
select ok(
  not has_table_privilege('anon', 'public.rls_owned_fixture', 'select'),
  'anonymous users do not receive the table grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.rls_ungranted_fixture', 'select'),
  'RLS alone does not expose an ungranted table through the Data API role'
);

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.rls_owned_fixture),
  1,
  'user A sees exactly one owned row'
);
select is(
  (select label from public.rls_owned_fixture),
  'user-a',
  'user A cannot read user B data'
);
select throws_ok(
  $$update public.rls_owned_fixture
    set owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    where id = '10000000-0000-0000-0000-000000000001'$$,
  '42501',
  'new row violates row-level security policy for table "rls_owned_fixture"',
  'WITH CHECK prevents user A from reassigning ownership'
);
reset role;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
set local role authenticated;
select is(
  (select label from public.rls_owned_fixture),
  'user-b',
  'user B cannot read user A data'
);
reset role;

select * from finish();
rollback;

