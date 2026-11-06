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
create schema cron; create table cron.job(jobid bigint,jobname text);
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
-- Minimal local PGMQ read contract: visibility, read count, and SKIP LOCKED.
-- This is a test shim, not proof of the production extension runtime.
create function pgmq.read(q text,visibility_seconds integer,quantity integer) returns setof pgmq.q_image_generation language sql as $$
 with selected as (
 select msg_id from pgmq.q_image_generation where q='image_generation' and vt<=clock_timestamp()
 order by msg_id limit quantity for update skip locked
 ) update pgmq.q_image_generation m set read_ct=m.read_ct+1,vt=clock_timestamp()+make_interval(secs=>visibility_seconds)
 from selected s where m.msg_id=s.msg_id returning m.*
$$;
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
create function public.isnt(actual anyelement,expected anyelement,label text) returns text language sql as $$select public.ok(actual is distinct from expected,label)$$;
create function public.lives_ok(query text,label text) returns text language plpgsql as $$begin execute query; return 'ok: '||label; end$$;
create function public.throws_ok(query text,code text,message text,label text) returns text language plpgsql as $$declare gotcode text; gotmessage text; begin begin execute query; exception when others then get stacked diagnostics gotcode=returned_sqlstate,gotmessage=message_text; end; if gotcode is distinct from code or (message is not null and gotmessage is distinct from message) then raise exception 'ASSERTION FAILED: % actual=[%] % expected=[%] %',label,gotcode,gotmessage,code,message; end if; return 'ok: '||label; end$$;
create function public.has_function(schema_name text,function_name text,args text[],label text) returns text language sql as $$select public.ok(to_regprocedure(format('%I.%I(%s)',schema_name,function_name,array_to_string(args,','))) is not null,label)$$;
create function public.finish() returns text language sql as $$select 'finished'::text$$;
`);
  let count = 0;
  for (const file of [
    "commerce_packages.test.sql", "chat_usage.test.sql", "chat_metering.test.sql", "provider_diagnostics.test.sql",
    "durable_generation_rejections.test.sql", "free_worker_recovery.test.sql",
    "openai_models.test.sql",
    "openai_prices.test.sql", "openai_chat_relay.test.sql", "doubao_edge_relay.test.sql",
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

  phase='two_connection_package_concurrency';
  const second=pg.getPgClient();await second.connect();
  try{
    const fixture=fs.readFileSync(root+'supabase/tests/database/commerce_packages.test.sql','utf8');
    const cost=fixture.match(/cost_versions values\('test-cost', '([^']+)'\)/)[1];
    const sale=fixture.match(/sale_versions values\('test-sale','([^']+)'\)/)[1];
    {
      await client.query("insert into private.commerce_package_cost_versions values('race-cost',$1)",[cost]);
      await client.query("insert into private.commerce_package_sale_versions values('race-sale',$1)",[sale]);
    }
    await client.query("update private.commerce_package_settings set enabled=true,cost_version='race-cost',sale_version='race-sale' where singleton;update private.credit_settings set enabled=true where singleton;");
    const uid=crypto.randomUUID(),sid=crypto.randomUUID(),ref=crypto.randomUUID();
    await client.query("insert into auth.users(id,email,email_confirmed_at,is_anonymous)values($1,'concurrency@example.com',now(),false)",[uid]);
    await client.query("insert into public.sessions(id,user_id,title)values($1,$2,'offline concurrency')",[sid,uid]);
    await client.query("insert into public.reference_uploads(id,user_id,session_id,storage_path,original_filename,mime_type,size_bytes,width,height)values($1,$2,$3,$4,'test.png','image/png',10,1,1)",[ref,uid,sid,`${uid}/${sid}/references/test.png`]);
    const call=async(connection,action,input)=>(await connection.query('select public.commerce_package_dispatch($1,$2,$3)as value',[uid,action,input])).rows[0].value;
    const quote=()=>call(client,'quote',{requestId:crypto.randomUUID(),sessionId:sid,selection:{modules:['品牌首屏','核心卖点'],advanced:false,referenceCount:1},references:[{id:ref,role:'product'}]});
    const q=await quote(),accept={quoteId:q.id,requestId:crypto.randomUUID(),totalMinor:q.snapshot.totalMinor};
    const accepted=await Promise.all([call(client,'accept',accept),call(second,'accept',accept)]);
    if(accepted[0].state.id!==accepted[1].state.id)throw Error('duplicate accept created multiple orders');
    const order=accepted[0],claim={...order.state,stages:order.state.stages.map((s,i)=>i===0?{...s,status:'processing',claimId:'race-claim'}:s)};
    const writes=await Promise.allSettled([call(client,'save',{orderId:order.state.id,expectedRevision:order.revision,state:claim}),call(second,'save',{orderId:order.state.id,expectedRevision:order.revision,state:claim})]);
    if(writes.filter(r=>r.status==='fulfilled').length!==1||writes.filter(r=>r.status==='rejected'&&r.reason.message==='revision_conflict').length!==1)throw Error('provider claim CAS failed');
    await Promise.all([call(client,'cancel',{orderId:order.state.id}),call(second,'cancel',{orderId:order.state.id})]);
    const held=[];
    for(let i=0;i<3;i++){const v=await quote();held.push(await call(client,'accept',{quoteId:v.id,requestId:crypto.randomUUID(),totalMinor:v.snapshot.totalMinor}));}
    const qa=await quote(),qb=await quote();
    const races=await Promise.allSettled([call(client,'accept',{quoteId:qa.id,requestId:crypto.randomUUID(),totalMinor:qa.snapshot.totalMinor}),call(second,'accept',{quoteId:qb.id,requestId:crypto.randomUUID(),totalMinor:qb.snapshot.totalMinor})]);
    if(races.filter(r=>r.status==='fulfilled').length!==1)throw Error('competing reservations overspent or both rejected');
    for(const r of races)if(r.status==='fulfilled')held.push(r.value);
    for(const r of held)await call(client,'cancel',{orderId:r.state.id});
    const w=(await client.query('select available_minor,frozen_minor,spent_minor from private.credit_wallets where user_id=$1',[uid])).rows[0];
    if(w.available_minor!=='1000'||w.frozen_minor!=='0'||w.spent_minor!=='0')throw Error('wallet conservation failed');
    const audit=(await client.query("select public.credit_admin($1)as value",[{action:'audit',userId:uid,actor:'offline-test',reason:'concurrency conservation'}])).rows[0].value;
    if(!audit.consistent)throw Error('ledger does not match wallet');
    console.log('TWO_CONNECTION_PASS: duplicate accept, one provider claim, duplicate cancellation, competing wallet reservations, ledger conservation');
    // Same funded chat may be submitted twice by the Web transport after a lost response.
    await client.query("insert into private.credit_price_versions select 'relay-race',prices||'[{\"operation\":\"chat\",\"provider\":\"gpt-6-astra\",\"model\":\"gpt-6-astra\",\"resolution\":\"\",\"unitMinor\":17,\"label\":\"Synthetic relay race\"}]',now()from private.credit_price_versions where version=(select version from private.credit_settings)");
    await client.query("update private.credit_settings set version='relay-race';update private.provider_runtime_config set enabled=true where provider='gpt-6-astra'");
    await client.query("insert into private.chat_usage_versions(version,tariff)values('race-token',$1)",[{model:'gpt-6-astra',requestModel:'gpt-6-astra',responseModels:['gpt-6-astra'],meteringVersion:2,serviceTier:'default',cacheTtl:'30m',cacheWritePerMillionNano:'14400000000',inputPerMillionNano:'14400000000',cachedInputPerMillionNano:'720000000',outputPerMillionNano:'72000000000',markupBps:10000,maxInputTokens:32000,maxOutputTokens:4000,evidence:'Synthetic offline concurrency tariff, never production'}]);
    await client.query("update private.chat_usage_settings set enabled=true,version='race-token'where model='gpt-6-astra'");
    const relayRequest=crypto.randomUUID();
    const tokenStart={requestId:relayRequest,operation:'chat',model:'gpt-6-astra',billing:{version:'relay-race',rateVersion:'race-token',totalMinor:150},input:{message:'Offline funded relay race'}};
    const tokenReservations=await Promise.all([client,second].map(c=>c.query("select public.credit_dispatch($1,'text_start',$2)as value",[uid,tokenStart])));
    if(tokenReservations[0].rows[0].value.id!==tokenReservations[1].rows[0].value.id)throw Error('Duplicate token reservation');
    await client.query("select public.credit_dispatch($1,'text_claim',$2)",[uid,{requestId:relayRequest}]);
    const relayClaims=await Promise.allSettled([client,second].map(c=>c.query("select public.openai_chat_relay($1,$2,'gpt-6-astra','claim')",[uid,relayRequest])));
    if(relayClaims.filter(r=>r.status==='fulfilled').length!==1||!relayClaims.some(r=>r.status==='rejected'&&r.reason.message==='relay_result_pending'))throw Error('Relay admitted duplicate provider attempts');
    console.log('RELAY_TWO_CONNECTION_PASS: exactly one funded provider attempt, competing replay stays pending');
    await client.query("select public.openai_chat_relay($1,$2,'gpt-6-astra','usage_result',$3)",[uid,relayRequest,JSON.stringify({content:'Saved token reply',receipt:{providerRequestId:'race-usage',resolvedModel:'gpt-6-astra',finishReason:'stop',inputTokens:1000,outputTokens:500,cachedInputTokens:0,totalTokens:1500,meteringVersion:2,serviceTier:'default',cacheTtl:'30m',cacheWriteTokens:0}})]);
    await Promise.all([client,second].map(c=>c.query("select public.chat_usage_dispatch($1,'complete',$2)",[uid,{requestId:relayRequest}])));
    const tokenWallet=(await client.query("select available_minor,frozen_minor,spent_minor from private.credit_wallets where user_id=$1",[uid])).rows[0];
    if(tokenWallet.available_minor!=='989'||tokenWallet.frozen_minor!=='0'||tokenWallet.spent_minor!=='11')throw Error('Token settlement double charge or refund');
    const stopRequest=crypto.randomUUID();await client.query("select public.chat_usage_dispatch($1,'start',$2)",[uid,{...tokenStart,requestId:stopRequest}]);await client.query("select public.credit_dispatch($1,'text_claim',$2)",[uid,{requestId:stopRequest}]);
    const stopRace=await Promise.allSettled([client.query("select public.openai_chat_relay($1,$2,'gpt-6-astra','claim')",[uid,stopRequest]),second.query("select public.openai_chat_relay($1,$2,'gpt-6-astra','reject_not_started')",[uid,stopRequest])]);
    if(stopRace.filter(x=>x.status==='fulfilled').length!==1)throw Error('Token claim and preflight refund were not mutually exclusive');
    console.log('TOKEN_TWO_CONNECTION_PASS: one cap reservation, exactly-once partial capture/release, claim and no-attempt refund mutually exclusive');

    await client.query("update private.provider_runtime_config set enabled=true where provider='doubao'");
    const optimizePrice=(await client.query("select (j->>'unitMinor')::int amount from private.credit_price_versions p,jsonb_array_elements(p.prices)j where p.version='relay-race'and j->>'model'='doubao'and j->>'operation'='optimize'")).rows[0].amount;
    const startOptimize=async()=>{
      const requestId=crypto.randomUUID(),input={field:'title',text:'Offline frozen input'};
      await client.query("select public.credit_dispatch($1,'text_start',$2)",[uid,{requestId,operation:'optimize',model:'doubao',billing:{version:'relay-race',totalMinor:optimizePrice},input}]);
      await client.query("select public.credit_dispatch($1,'text_claim',$2)",[uid,{requestId}]);
      return{requestId,payload:{input,payloadHash:'a'.repeat(64)}};
    };
    const textRelay=(connection,id,action,payload)=>connection.query("select public.doubao_text_relay($1,$2,'optimize',$3,$4)",[uid,id,action,payload]);
    const da=await startOptimize();
    const daRace=await Promise.allSettled([client,second].map(c=>textRelay(c,da.requestId,'claim',da.payload)));
    if(daRace.filter(x=>x.status==='fulfilled').length!==1||!daRace.some(x=>x.status==='rejected'&&x.reason.message==='relay_result_pending'))throw Error('Doubao admitted duplicate attempts');
    const db=await startOptimize();
    const dbRace=await Promise.allSettled([textRelay(client,db.requestId,'claim',db.payload),textRelay(second,db.requestId,'reject_not_started',db.payload)]);
    if(dbRace.filter(x=>x.status==='fulfilled').length!==1)throw Error('No-attempt rejection raced with provider claim unsafely');
    const conserved=(await client.query("select available_minor+frozen_minor+spent_minor total from private.credit_wallets where user_id=$1",[uid])).rows[0].total;
    if(conserved!=='1000')throw Error('Doubao concurrency violated wallet conservation');
    console.log('DOUBAO_TWO_CONNECTION_PASS: one attempt; claim and no-attempt refund mutually exclusive; wallet conserved');

    phase='two_connection_diagnostic_claim';
    const diagnosticCampaign=crypto.randomUUID();
    await client.query("insert into private.provider_diagnostic_campaigns(id,approval_ref,approved_at,expires_at,state)values($1,'synthetic concurrency approval',clock_timestamp(),clock_timestamp()+interval '10 minutes','armed')",[diagnosticCampaign]);
    const diagnostic=(connection,slot,action,result=null)=>connection.query('select public.provider_diagnostic($1,$2,$3,$4) as value',[diagnosticCampaign,slot,action,result]);
    const diagnosticRace=await Promise.all([diagnostic(client,'astra','claim'),diagnostic(second,'astra','claim')]);
    if(diagnosticRace.filter(x=>x.rows[0].value.action==='start').length!==1||!diagnosticRace.some(x=>x.rows[0].value.attemptState==='claimed'))throw Error('Diagnostic admitted duplicate provider attempts');
    const diagnosticReceipt={outcome:'verified',receipt:{providerRequestId:'chatcmpl-concurrent',resolvedModel:'gpt-6-astra',serviceTier:'default',requestedCacheTtl:'30m',inputTokens:12,outputTokens:2,totalTokens:14,cachedInputTokens:0,cacheWriteTokens:0,finishReason:'stop'}};
    await Promise.all([diagnostic(client,'astra','record',diagnosticReceipt),diagnostic(second,'astra','record',diagnosticReceipt)]);
    const diagnosticReplay=await diagnostic(client,'astra','claim');
    if(diagnosticReplay.rows[0].value.attemptState!=='verified')throw Error('Diagnostic lost durable receipt');
    const diagnosticSolRace=await Promise.all([diagnostic(client,'sol','claim'),diagnostic(second,'sol','claim')]);
    if(diagnosticSolRace.filter(x=>x.rows[0].value.action==='start').length!==1)throw Error('Diagnostic second slot duplicated');
    await diagnostic(client,'sol','record',{outcome:'uncertain',reason:'provider_evidence_unverified'});
    if((await diagnostic(second,'sol','claim')).rows[0].value.attemptState!=='needs_review')throw Error('Unknown diagnostic result was retried');
    if((await client.query('select count(*)::int n from private.provider_diagnostic_attempts where campaign_id=$1',[diagnosticCampaign])).rows[0].n!==2)throw Error('Diagnostic exceeded two attempts');
    console.log('DIAGNOSTIC_TWO_CONNECTION_PASS: one attempt per slot; duplicate receipt idempotent; lost acknowledgement and unknown result never resend');


  }finally{await second.end();}
  console.log("SQL_ASSERTIONS_PASS", count);
  console.log("PASS", count, (await db.query("select version()")).rows);
  await db.close();
} catch (e) {
  console.error("FAILED PHASE", phase, e.message, e.detail, e.where);
  await db.close();
  process.exitCode = 1;
}
