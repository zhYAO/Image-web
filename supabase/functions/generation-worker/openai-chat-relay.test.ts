import{expect,it,vi}from'vitest';
import{handleOpenAIChat}from'../_shared/openai-chat-relay';
const uid='22222222-2222-4222-8222-222222222222',rid='11111111-1111-4111-8111-111111111111';
const request=(extra={})=>new Request('http://local',{method:'POST',body:JSON.stringify({userId:uid,requestId:rid,model:'gpt-6-astra',...extra})});
const env=(n:string)=>n==='ZIMAGE_OPENAI_ENABLED'?'true':n==='OPENAI_API_KEY'?'test-only-secret':undefined;
const success=()=>new Response('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
function setup(action='start'){const calls:string[]=[];const admin={rpc:async(_n:string,p:Record<string,unknown>)=>{calls.push(String(p.p_action));return{data:p.p_action==='claim'?{action,model:'gpt-6-astra',messages:[{role:'user',content:'frozen history'}],content:'saved'}:{saved:true},error:null};}};return{admin,calls};}
it('refuses untrusted callers before any RPC or upstream',async()=>{const t=setup(),fetcher=vi.fn();expect((await handleOpenAIChat(request(),{...t,authorized:false,env,fetcher})).status).toBe(401);expect(t.calls).toEqual([]);expect(fetcher).not.toHaveBeenCalled();});
it('rejects arbitrary prompt and owner overrides before a durable claim',async()=>{const t=setup();expect((await handleOpenAIChat(request({messages:[]}),{...t,authorized:true,env,fetcher:vi.fn()})).status).toBe(400);expect(t.calls).toEqual([]);});
it('uses frozen server history and saves before forwarding completion, with no key in output',async()=>{const t=setup();const fetcher=vi.fn(async(_u:unknown,init:RequestInit)=>{expect(JSON.parse(String(init.body)).messages[0].content).toBe('frozen history');return success();});const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher});const text=await r.text();expect(t.calls).toEqual(['inspect','claim','result']);expect(text).toContain('[DONE]');expect(text).not.toContain('test-only-secret');expect(fetcher).toHaveBeenCalledOnce();});
it('replays a persisted result without calling OpenAI again',async()=>{const t=setup('replay'),fetcher=vi.fn();const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher});expect(await r.text()).toContain('saved');expect(fetcher).not.toHaveBeenCalled();});
it('does not send a successful terminal marker when result persistence fails',async()=>{const t=setup();t.admin.rpc=async(_n,p)=>p.p_action==='result'?{data:null,error:{message:'failed'}}as never:{data:{action:'start',model:'gpt-6-astra',messages:[]},error:null}as never;const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher:async()=>success()});await expect(r.text()).rejects.toThrow();});
it('never retries or echoes an upstream error body',async()=>{const t=setup(),fetcher=vi.fn(async()=>new Response('private upstream body',{status:500}));const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher});await expect(r.text()).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();});

it('Doubao uses the same funded frozen-history protocol with Edge-only Ark credentials',async()=>{
 const t=setup();t.admin.rpc=async(name,p)=>{expect(name).toBe('doubao_chat_relay');return{data:p.p_action==='claim'?{action:'start',model:'doubao',messages:[{role:'user',content:'frozen history'}]}:{saved:true},error:null}as never;};
 const f=vi.fn(async(url,init)=>{expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');expect(JSON.parse(init.body).model).toBe('physical-ark');return success();});
 const r=await handleOpenAIChat(request({model:'doubao'}),{...t,authorized:true,provider:'doubao',env:n=>({ARK_API_KEY:'synthetic',ZIMAGE_DOUBAO_EDGE_ENABLED:'true',ZIMAGE_DOUBAO_CHAT_MODEL:'physical-ark'}as Record<string,string>)[n],fetcher:f});
 expect(await r.text()).toContain('[DONE]');expect(f).toHaveBeenCalledOnce();
});

it('enabled Doubao chat with missing configuration reports no-attempt only with persisted SQL proof',async()=>{
 const t=setup(),f=vi.fn();t.admin.rpc=async(_n,p)=>{expect(p.p_action).toBe('reject_not_started');return{data:{notStarted:true},error:null}as never;};
 const r=await handleOpenAIChat(request({model:'doubao'}),{...t,authorized:true,provider:'doubao',env:n=>n==='ZIMAGE_DOUBAO_EDGE_ENABLED'?'true':undefined,fetcher:f});
 expect(await r.json()).toEqual({error:'relay_not_started'});expect(f).not.toHaveBeenCalled();
});
it('waits for post-finish usage, binds the frozen model budget and checkpoints the receipt before terminal SSE',async()=>{
 const t=setup();let payload:any;const actions:string[]=[];t.admin.rpc=async(_n,p)=>{actions.push(String(p.p_action));if(p.p_action==='inspect')return{data:{action:'legacy'},error:null}as never;if(p.p_action==='claim')return{data:{action:'start',model:'gpt-6-astra',messages:[{role:'user',content:'test'}],billingMode:'usage_capped',physicalModel:'gpt-6-astra',maxInputTokens:32000,maxOutputTokens:4000},error:null}as never;payload=JSON.parse(String(p.p_content));return{data:{saved:true},error:null}as never;};
 const fetcher=vi.fn(async(_u,init)=>{const body=JSON.parse(init.body);expect(body.max_completion_tokens).toBe(4000);expect(body.stream_options).toEqual({include_usage:true});return new Response('data: {"id":"completion-1","model":"gpt-6-astra","choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: {"id":"completion-1","model":"gpt-6-astra","choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500,"prompt_tokens_details":{"cached_tokens":0}}}\n\ndata: [DONE]\n\n');});
 const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher});expect(await r.text()).toContain('[DONE]');expect(actions).toEqual(['inspect','claim','usage_result']);expect(payload).toMatchObject({content:'Hello',receipt:{providerRequestId:'completion-1',resolvedModel:'gpt-6-astra',finishReason:'stop',inputTokens:1000,outputTokens:500,totalTokens:1500,cachedInputTokens:0}});
});
it('preserves completed prose with a null receipt when trustworthy usage never arrives',async()=>{const t=setup();let receipt:any;t.admin.rpc=async(_n,p)=>p.p_action==='inspect'?{data:{action:'legacy'},error:null}as never:p.p_action==='claim'?{data:{action:'start',model:'gpt-6-astra',messages:[],billingMode:'usage_capped',physicalModel:'gpt-6-astra',maxInputTokens:32000,maxOutputTokens:4000},error:null}as never:(receipt=JSON.parse(String(p.p_content)),{data:{saved:true},error:null}as never);const r=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher:async()=>success()});expect(await r.text()).toContain('Hello');expect(receipt).toEqual({content:'Hello',receipt:null});});

it('rejects an insufficient byte budget before any supplier attempt and proves the full release',async()=>{const t=setup(),f=vi.fn();const actions:string[]=[];t.admin.rpc=async(_n,p)=>{actions.push(String(p.p_action));return{data:p.p_action==='inspect'?{action:'ready',billingMode:'usage_capped',messages:[{role:'user',content:'hello'}],maxInputTokens:1024,maxOutputTokens:4000}:{notStarted:true},error:null}as never;};const response=await handleOpenAIChat(request(),{...t,authorized:true,env,fetcher:f});expect(await response.json()).toEqual({error:'relay_not_started'});expect(actions).toEqual(['inspect','reject_not_started']);expect(f).not.toHaveBeenCalled();});


it.each(['false',undefined])('disabled Doubao chat rejects before RPC, refund or credential reads (flag=%s)',async flag=>{
 const admin={rpc:vi.fn(async()=>({data:{notStarted:true},error:null}))},fetcher=vi.fn(),reads:string[]=[];
 const r=await handleOpenAIChat(request({model:'doubao'}),{authorized:true,provider:'doubao',admin,fetcher,env:n=>{
  reads.push(n);return({ZIMAGE_DOUBAO_EDGE_ENABLED:flag,ARK_API_KEY:'synthetic',ZIMAGE_DOUBAO_CHAT_MODEL:'frozen-model'}as Record<string,string|undefined>)[n];
 }});
 expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'unavailable'});
 expect(admin.rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 expect(reads).not.toContain('ARK_API_KEY');
});
it('disabled OpenAI chat does not read its supplier credential',async()=>{
 const admin={rpc:vi.fn()},fetcher=vi.fn(),reads:string[]=[];
 const r=await handleOpenAIChat(request(),{authorized:true,admin,fetcher,env:n=>{reads.push(n);return n==='ZIMAGE_OPENAI_ENABLED'?'false':'synthetic';}});
 expect(r.status).toBe(503);expect(admin.rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect(reads).not.toContain('OPENAI_API_KEY');
});
