// Run only against a disposable local database; never accepts a remote URL.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { default: EmbeddedPostgres } = await import(
  process.env.LOCAL_PG_MODULE ?? "embedded-postgres"
);
const pg = new EmbeddedPostgres({
  databaseDir:
    process.env.LOCAL_PG_DIR ?? "/private/tmp/zimage-credits-test-db",
  port: 55439,
  user: "postgres",
  password: "local-test-only",
  persistent: false,
  initdbFlags: ["--locale=C", "--encoding=UTF8"],
  postgresFlags: ["-h", "127.0.0.1", "-c", "timezone=UTC"],
  onLog: () => {},
  onError: () => {},
});
await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const db = {
  exec: async (sql) => {
    const r = await client.query(sql);
    return Array.isArray(r) ? r : [r];
  },
  query: (sql) => client.query(sql),
  close: async () => {
    await client.end();
    await pg.stop();
  },
};
let phase = "bootstrap";
try {
  await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage; create schema extensions; create schema pgmq;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}',deleted_at timestamptz,banned_until timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}');
create table pgmq.meta(queue_name text primary key);
create table pgmq.q_image_generation(msg_id bigint generated always as identity primary key,read_ct integer default 0,enqueued_at timestamptz default now(),vt timestamptz default now(),message jsonb);
create table pgmq.a_image_generation(like pgmq.q_image_generation);
create function pgmq.create(q text) returns void language sql as $$insert into pgmq.meta values(q)$$;
create function pgmq.send(q text,m jsonb) returns bigint language sql as $$insert into pgmq.q_image_generation(message) values(m) returning msg_id$$;
create function pgmq.archive(q text,id bigint) returns boolean language sql as $$with d as (delete from pgmq.q_image_generation where msg_id=id returning *) insert into pgmq.a_image_generation select * from d returning true$$;
set search_path=public,extensions;
`);
  const names = fs
    .readdirSync(root + "supabase/migrations")
    .filter((n) => n.endsWith(".sql") && !/schedule|scheduling/.test(n))
    .sort();
  const upgradeUser = 'ccccaaaa-0000-4000-8000-000000000001';
  const protectedTables = ['public.sessions','public.generation_batches','public.generations','public.reference_uploads','public.commerce_tasks','public.commerce_revisions','private.quota_ledger','private.generation_work','pgmq.q_image_generation'];
  const snapshot = async () => {
    const data = {};
    for (const table of protectedTables) data[table] = (await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from ${table} t`)).rows[0].rows;
    return JSON.stringify(data);
  };
  let beforeUpgrade;
  for (const n of names) {
    if (n === '20260913082732_commerce_xhs_poster.sql') {
      await client.query(`
update private.runtime_flags set enabled=true where flag='generation_enabled';
update private.provider_runtime_config set enabled=true where provider in ('gemini','seedream');
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values('${upgradeUser}','upgrade@example.com',now(),false);
insert into public.sessions(id,user_id,title) values('${upgradeUser}','${upgradeUser}','保留旧方案');
insert into public.generation_batches(id,user_id,session_id,source,prompt,provider,model,config,idempotency_key,request_hash) values('${upgradeUser}','${upgradeUser}','${upgradeUser}','direct','旧图片提示词','seedream','seedream-4.5','{}','upgrade-fixture','upgrade-fixture');
insert into public.generations(id,batch_id,provider,model,status,prompt,params,provider_submission_state,error_code) values('${upgradeUser}','${upgradeUser}','seedream','seedream-4.5','failed','旧图片提示词','{}','unknown','provider_reconciliation_required');
insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height) values('${upgradeUser}','${upgradeUser}','${upgradeUser}','upgrade/reference.png','reference.png','image/png',100,10,10);
insert into public.commerce_tasks(id,user_id,session_id) values('${upgradeUser}','${upgradeUser}','${upgradeUser}');
insert into public.commerce_revisions(task_id,revision,plan) values('${upgradeUser}',1,'{"scene":"product-main","brief":{"name":"旧商品"},"slots":[{"provider":"seedream","model":"seedream-4.5","prompt":"旧图片提示词"}]}');
insert into private.quota_ledger(user_id,generation_id,entry_type,amount,business_key) values('${upgradeUser}','${upgradeUser}','reserve',1,'upgrade-fixture');
select pgmq.send('image_generation','{"generationId":"${upgradeUser}"}');
update private.runtime_flags set enabled=false where flag='generation_enabled';
update private.provider_runtime_config set enabled=false where provider in ('gemini','seedream');
`);
      beforeUpgrade = await snapshot();
    }
    phase = n;
    let sql = fs
      .readFileSync(root + "supabase/migrations/" + n, "utf8")
      .replace(/create extension if not exists pgmq;/g, "");
    await db.exec(sql);
    console.log("MIGRATION", n);
  }
  if (!beforeUpgrade || beforeUpgrade !== await snapshot()) throw new Error('Upgrade changed existing content, unknown task, queue, or quota records');
  const welcome = (await client.query('select available_minor,frozen_minor,spent_minor from private.credit_wallets where user_id=$1',[upgradeUser])).rows[0];
  if (welcome.available_minor !== '1000' || welcome.frozen_minor !== '0' || welcome.spent_minor !== '0') throw new Error('Existing account grant or historical billing changed');
  if ((await client.query('select count(*)::int as n from private.credit_operations')).rows[0].n !== 0) throw new Error('Upgrade billed a historical task');
  console.log('UPGRADE_PRESERVATION_PASS: 9 protected tables unchanged, verified welcome 1000 once, no historical charges');
  await client.query('delete from auth.users where id=$1',[upgradeUser]);
  await client.query('delete from pgmq.q_image_generation');
  await db.exec(`
create function public.no_plan() returns text language sql as $$select 'assertion shim'::text$$;
create function public.ok(actual boolean,label text) returns text language plpgsql as $$begin if actual is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if; return 'ok: '||label; end$$;
create function public.is(actual anyelement,expected anyelement,label text) returns text language plpgsql as $$begin if actual is distinct from expected then raise exception 'ASSERTION FAILED: % actual=% expected=%',label,actual,expected; end if; return 'ok: '||label; end$$;
create function public.lives_ok(query text,label text) returns text language plpgsql as $$begin execute query; return 'ok: '||label; end$$;
create function public.throws_ok(query text,code text,message text,label text) returns text language plpgsql as $$declare gotcode text; gotmessage text; begin begin execute query; exception when others then get stacked diagnostics gotcode=returned_sqlstate,gotmessage=message_text; end; if gotcode is distinct from code or (message is not null and gotmessage is distinct from message) then raise exception 'ASSERTION FAILED: % actual=[%] % expected=[%] %',label,gotcode,gotmessage,code,message; end if; return 'ok: '||label; end$$;
create function public.has_function(schema_name text,function_name text,args text[],label text) returns text language sql as $$select public.ok(to_regprocedure(format('%I.%I(%s)',schema_name,function_name,array_to_string(args,','))) is not null,label)$$;
create function public.finish() returns text language sql as $$select 'finished'::text$$;
`);
  let count = 0;
  for (const file of [
    "commerce_tasks.test.sql",
    "commerce_xhs_poster.test.sql",
    "session_activity_summary.test.sql",
    "credits.test.sql",
    "apparel_catalog.test.sql",
  ]) {
    phase = file;
    const sql = fs
      .readFileSync(root + "supabase/tests/database/" + file, "utf8")
      .replace(
        /create extension if not exists pgtap with schema extensions;/g,
        "",
      );
    const result = await db.exec(sql);
    const lines = result
      .flatMap((r) => r.rows)
      .flatMap((r) => Object.values(r))
      .filter((x) => typeof x === "string" && x.startsWith("ok:"));
    count += lines.length;
    console.log("TEST", file, lines.length);
    for (const l of lines) console.log(l);
  }
  console.log("SQL_ASSERTIONS_PASS", count);
  const second = pg.getPgClient();
  await second.connect();
  try {
    const uid = "bbbbaaaa-0000-4000-8000-000000000001";
    await client.query(
      `insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,'concurrency@example.com',now(),false)`,
      [uid],
    );
    await client.query(`select public.credit_dispatch($1,'wallet')`, [uid]);
    await client.query(
      `update private.credit_settings set enabled=true;update private.credit_wallets set available_minor=2 where user_id='${uid}'`,
    );
    const input = (id) => ({
      requestId: id,
      operation: "optimize",
      model: "doubao",
      billing: { version: "2026-10-06.1", totalMinor: 5 },
      input: { text: "example" },
    });
    // Exactly one 5-unit operation can fit; the competing connection waits for the account lock.
    await client.query(
      `update private.credit_wallets set available_minor=5 where user_id=$1`,
      [uid],
    );
    const a = input("bbbb0000-0000-4000-8000-000000000001"),
      b = input("bbbb0000-0000-4000-8000-000000000002");
    await client.query("begin");
    await client.query(`select public.credit_dispatch($1,'text_start',$2)`, [
      uid,
      a,
    ]);
    const competing = second
      .query(`select public.credit_dispatch($1,'text_start',$2)`, [uid, b])
      .then(
        () => ({ ok: true }),
        (error) => ({ error: error.message }),
      );
    let lockObserved = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await client.query("select pg_stat_clear_snapshot()");
      const activity = await client.query(
        "select wait_event_type from pg_stat_activity where pid=$1",
        [second.processID],
      );
      if (activity.rows[0]?.wait_event_type === "Lock") {
        lockObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!lockObserved)
      throw new Error(
        "The second connection did not wait on the held transaction lock",
      );
    await client.query("commit");
    const rejected = await competing;
    if (rejected.error !== "insufficient_credits")
      throw new Error("Competing balance reservation did not fail atomically");
    const replay = await second.query(
      `select public.credit_dispatch($1,'text_start',$2) as op`,
      [uid, a],
    );
    if (replay.rows[0].op.status !== "reserved")
      throw new Error("Replay lost operation");
    const claims = await Promise.all(
      [client, second].map((c) =>
        c.query(`select public.credit_dispatch($1,'text_claim',$2) as op`, [
          uid,
          a,
        ]),
      ),
    );
    if (claims.filter((r) => r.rows[0].op.claimed).length !== 1)
      throw new Error("More than one provider claim");
    const completions = await Promise.all(
      [client, second].map((c) =>
        c.query(`select public.credit_dispatch($1,'text_refund',$2)`, [uid, a]),
      ),
    );
    if (completions.length !== 2) throw new Error("Refund response missing");
    const wallet = (
      await client.query(
        `select public.credit_dispatch($1,'wallet') as wallet`,
        [uid],
      )
    ).rows[0].wallet;
    if (wallet.availableMinor !== 5 || wallet.frozenMinor !== 0)
      throw new Error("Concurrent refund did not conserve balance");
    const duplicate = input("bbbb0000-0000-4000-8000-000000000003");
    await client.query("begin");
    const first = (
      await client.query(
        `select public.credit_dispatch($1,'text_start',$2) as op`,
        [uid, duplicate],
      )
    ).rows[0].op;
    const duplicated = second.query(
      `select public.credit_dispatch($1,'text_start',$2) as op`,
      [uid, duplicate],
    );
    await client.query("commit");
    if ((await duplicated).rows[0].op.id !== first.id)
      throw new Error("Concurrent duplicate created a second operation");
    await client.query(`select public.credit_dispatch($1,'text_refund',$2)`, [
      uid,
      duplicate,
    ]);
    console.log(
      "DUAL_CONNECTION_PASS: observed transaction lock, competing balance, concurrent duplicate, single claim, idempotent refund",
    );
  } finally {
    await client.query("rollback").catch(() => undefined);
    await second.end();
  }
  console.log("PASS", count, (await db.query("select version()")).rows);
  await db.close();
} catch (e) {
  console.error("FAILED PHASE", phase, e.message, e.detail, e.where);
  await db.close();
  process.exitCode = 1;
}
