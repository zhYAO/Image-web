import{expect,it,vi}from'vitest';
import{handleDoubaoText}from'../_shared/doubao-text-relay';
const userId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',claimId='33333333-3333-4333-8333-333333333333';
const ref={id:'44444444-4444-4444-8444-444444444444',role:'product',dataUrl:'data:image/png;base64,AA=='};
const body={userId,requestId,claimId,operation:'analysis',prompt:'compiled facts',images:[ref]};
const req=(b:unknown=body)=>new Request('http://local',{method:'POST',body:JSON.stringify(b)});
const env=(n:string)=>({ZIMAGE_DOUBAO_EDGE_ENABLED:'true',ARK_API_KEY:'synthetic-only',ZIMAGE_DOUBAO_VISION_MODEL:'frozen-vision'}as Record<string,string>)[n];
const receipt={text:'{}',model:'frozen-vision'};
function setup(replay=false){const calls:Record<string,unknown>[]=[];const admin={rpc:vi.fn(async(_n:string,p:Record<string,unknown>)=>{calls.push(p);return{error:null,data:p.p_action==='result'?{saved:true}:replay?{action:'replay',receipt}:{action:p.p_action==='inspect'?'ready':'start',model:'frozen-vision',maxOutputTokens:4000,references:[{id:ref.id,role:ref.role}]}};})};return{admin,calls};}
const success=()=>Response.json({id:'receipt',model:'version',service_tier:'default',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2,prompt_tokens_details:{cached_tokens:0}},choices:[{finish_reason:'stop',message:{content:'{}'}}]});
it('blocks untrusted callers before any RPC',async()=>{const t=setup(),fetcher=vi.fn();expect((await handleDoubaoText(req(),{...t,authorized:false,env,fetcher})).status).toBe(401);expect(t.calls).toEqual([]);});
it.each([{...body,endpoint:'https://evil.test'},{...body,model:'free'},{...body,images:[{...ref,dataUrl:'https://private.test'}]},{...body,operation:'planning'},{...body,recoverOnly:true}])('rejects alternate input before claim',async b=>{const t=setup(),f=vi.fn();expect((await handleDoubaoText(req(b),{...t,authorized:true,env,fetcher:f})).status).toBe(400);expect(t.calls).toEqual([]);expect(f).not.toHaveBeenCalled();});
it('uses frozen model and saves receipt before response; no image or prompt stored in RPC',async()=>{const t=setup();const f=vi.fn(async(url,init)=>{expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');expect(JSON.parse(init.body).model).toBe('frozen-vision');return success();});const r=await handleDoubaoText(req(),{...t,authorized:true,env,fetcher:f});expect(r.status).toBe(200);expect(t.calls.map(x=>x.p_action)).toEqual(['inspect','claim','result']);expect(JSON.stringify(t.calls[0])).not.toContain('data:image');expect(JSON.stringify(t.calls[0])).not.toContain('compiled facts');expect(await r.text()).not.toContain('synthetic-only');});
it('read-only recovery works without keys or flags and never calls upstream',async()=>{const t=setup(true),f=vi.fn();const r=await handleDoubaoText(req({userId,requestId,claimId,operation:'analysis',recoverOnly:true}),{...t,authorized:true,env:()=>undefined,fetcher:f});expect(await r.json()).toEqual(receipt);expect(t.calls[0].p_action).toBe('read');expect(f).not.toHaveBeenCalled();});
it('missing receipt never restarts a supplier during recovery',async()=>{const t=setup(),f=vi.fn();expect((await handleDoubaoText(req({userId,requestId,claimId,operation:'analysis',recoverOnly:true}),{...t,authorized:true,env,fetcher:f})).status).toBe(503);expect(f).not.toHaveBeenCalled();});
it('lost receipt persistence stays unknown',async()=>{const t=setup();t.admin.rpc.mockImplementation(async(_n,p)=>p.p_action==='result'?{data:null,error:{message:'lost'}}as never:{data:{action:p.p_action==='inspect'?'ready':'start',model:'frozen-vision',maxOutputTokens:4000,references:[{id:ref.id,role:ref.role}]},error:null}as never);expect((await handleDoubaoText(req(),{...t,authorized:true,env,fetcher:async()=>success()})).status).toBe(503);});
it('changed mapping or reference binding prevents a supplier call',async()=>{const t=setup(),f=vi.fn();t.admin.rpc.mockResolvedValue({data:{action:'start',model:'other',maxOutputTokens:4000,references:[]},error:null}as never);expect((await handleDoubaoText(req(),{...t,authorized:true,env,fetcher:f})).status).toBe(503);expect(f).not.toHaveBeenCalled();});
it('unknown network failure gets one attempt and no sensitive error details',async()=>{const t=setup(),f=vi.fn(async()=>{throw Error('synthetic-only private payload');});const r=await handleDoubaoText(req(),{...t,authorized:true,env,fetcher:f});expect(r.status).toBe(503);expect(await r.text()).not.toContain('private payload');expect(f).toHaveBeenCalledOnce();});

it('enabled text relay with missing configuration can only report not-started after atomic SQL proof',async()=>{
 const t=setup(),f=vi.fn();t.admin.rpc.mockResolvedValue({data:{notStarted:true},error:null}as never);
 const r=await handleDoubaoText(req({userId,requestId,operation:'optimize',prompt:'compiled',input:{text:'frozen'}}),{...t,authorized:true,env:n=>n==='ZIMAGE_DOUBAO_EDGE_ENABLED'?'true':undefined,fetcher:f});
 expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'relay_not_started'});expect(t.admin.rpc.mock.calls[0][1].p_action).toBe('reject_not_started');expect(f).not.toHaveBeenCalled();
});


it.each(['analysis','planning','optimize'])('disabled text relay refuses %s without RPC, refund or credentials',async operation=>{
 const admin={rpc:vi.fn(async()=>({data:{notStarted:true},error:null}))},fetcher=vi.fn(),reads:string[]=[];
 const b=operation==='analysis'?body:operation==='planning'?{...body,operation,images:[]}:{userId,requestId,operation,prompt:'compiled',input:{text:'frozen'}};
 const r=await handleDoubaoText(req(b),{authorized:true,admin,fetcher,env:n=>{reads.push(n);return n==='ZIMAGE_DOUBAO_EDGE_ENABLED'?'false':'synthetic';}});
 expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'unavailable'});
 expect(admin.rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(reads).not.toContain('ARK_API_KEY');
});
it('disabled receipt recovery reads only saved state and no supplier credential',async()=>{
 const admin={rpc:vi.fn(async(_name,p)=>{expect(p.p_action).toBe('read');return{data:{action:'replay',receipt},error:null};})},fetcher=vi.fn(),reads:string[]=[];
 const r=await handleDoubaoText(req({userId,requestId,claimId,operation:'analysis',recoverOnly:true}),{authorized:true,admin,fetcher,env:n=>{reads.push(n);return undefined;}});
 expect(await r.json()).toEqual(receipt);expect(admin.rpc).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled();expect(reads).not.toContain('ARK_API_KEY');
});
