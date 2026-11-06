import {afterEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({calls:[]as Array<Record<string,unknown>>,auth:true}));
const user='22222222-2222-4222-8222-222222222222';
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:async()=>fixture.auth?{data:'22222222-2222-4222-8222-222222222222',error:null,status:200}:{data:null,error:{code:'P0001',message:'unauthorized'},status:401}})}));
vi.mock('@/lib/supabase/admin',()=>({createSupabaseAdminClient:()=>({rpc:async(_n:string,args:Record<string,unknown>)=>{fixture.calls.push(args);return{data:null,error:{code:'PGRST202',message:'missing_local_test_migration'}};}})}));
import {GET,POST} from '@/app/api/commerce-packages/route';
afterEach(()=>{fixture.calls=[];fixture.auth=true;vi.unstubAllEnvs();});
const post=(body:unknown,origin='http://localhost')=>POST(new Request('http://localhost/api/commerce-packages',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
it('keeps all new paid actions closed without an enabled feature, regardless of client overrides',async()=>{
 vi.stubEnv('ZIMAGE_COMMERCE_PACKAGES_ENABLED','false');const r=await post({action:'quote',enabled:true,price:0});expect(r.status).toBe(503);expect(fixture.calls).toHaveLength(0);
});
it('verifies identity even when the package feature is paused',async()=>{
 fixture.auth=false;const r=await GET(new Request('http://localhost/api/commerce-packages'));expect(r.status).toBe(401);
});
it('rejects an untrusted origin before any package RPC',async()=>{
 const r=await post({action:'cancel',orderId:crypto.randomUUID()},'https://attacker.invalid');expect(r.status).toBe(403);expect(fixture.calls).toHaveLength(0);
});
it('rejects caller-supplied owner, price and markup on an enabled quote endpoint',async()=>{
 vi.stubEnv('ZIMAGE_COMMERCE_PACKAGES_ENABLED','true');
 const r=await post({action:'quote',requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),imageModel:'doubao-seedream-5.0-pro',selection:{modules:['品牌首屏'],advanced:false,referenceCount:1},references:[{id:crypto.randomUUID(),role:'product'}],userId:user,totalMinor:0,markupBps:0});
 expect(r.status).toBe(400);expect(fixture.calls).toHaveLength(0);
});
it('does not quote or reserve when server cost configuration is unavailable',async()=>{
 vi.stubEnv('ZIMAGE_COMMERCE_PACKAGES_ENABLED','true');
 const r=await post({action:'quote',requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),imageModel:'doubao-seedream-5.0-pro',selection:{modules:['品牌首屏'],advanced:false,referenceCount:1},references:[{id:crypto.randomUUID(),role:'product'}]});
 expect(r.status).toBe(503);expect(fixture.calls.every(c=>c.p_action==='config'&&c.p_user_id===user)).toBe(true);
});
it('bounds JSON before creating a billing request',async()=>{
 vi.stubEnv('ZIMAGE_COMMERCE_PACKAGES_ENABLED','true');const r=await post({action:'quote',text:'x'.repeat(40000)});expect(r.status).toBe(413);expect(fixture.calls).toHaveLength(0);
});

it('discovers original owned unsettled orders even when new packages are paused',async()=>{
 vi.stubEnv('ZIMAGE_COMMERCE_PACKAGES_ENABLED','false');await GET(new Request('http://localhost/api/commerce-packages?active=1'));
 expect(fixture.calls).toContainEqual(expect.objectContaining({p_user_id:user,p_action:'list'}));
});
