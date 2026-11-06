import openai from '../../functions/openai-chat/index.ts';
import doubao from '../../functions/doubao-chat/index.ts';
import stage from '../../functions/doubao-text/index.ts';

const userId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',claimId='33333333-3333-4333-8333-333333333333';
const defaultKey='sb_secret_synthetic_default_not_real',otherKey='sb_secret_synthetic_other_not_real';
function assert(value:unknown,label:string):asserts value{if(!value)throw Error(label);}
const request=(body:unknown,key?:string)=>new Request('https://native-test.invalid/',{method:'POST',headers:{'content-type':'application/json',...(key?{apikey:key}:{})},body:JSON.stringify(body)});

Deno.test('real SDK secret auth rejects missing, publishable, other named key and bearer-only credentials before any RPC',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('unexpected_network');};
 try{
  for(const entry of[openai,doubao,stage]){
   for(const key of[undefined,'sb_publishable_synthetic_not_real',otherKey]){
    const r=await entry.fetch(request({},key));assert(r.status===401,'untrusted_credentials_not_rejected');await r.body?.cancel();
   }
   const r=await entry.fetch(new Request('https://native-test.invalid/',{method:'POST',headers:{authorization:'Bearer synthetic_invalid_jwt'},body:'{}'}));assert(r.status===401,'bearer_only_must_not_authorize');await r.body?.cancel();
  }assert(calls===0,'unauthorized_request_reached_network');
 }finally{globalThis.fetch=original;}
});

Deno.test('real SDK accepts only default key then validates the relay body without a provider call',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('unexpected_network');};
 try{for(const entry of[openai,doubao,stage]){const r=await entry.fetch(request({arbitraryPrompt:'refuse'},defaultKey));assert(r.status===400,'default_secret_did_not_reach_body_validation');await r.body?.cancel();}assert(calls===0,'invalid_body_reached_network');}
 finally{globalThis.fetch=original;}
});

Deno.test('native OpenAI entry uses real SDK RPC and persists before successful SSE completion',async()=>{
 const original=globalThis.fetch,actions:string[]=[];let providerCalls=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.startsWith('https://native-test.supabase.invalid/rest/v1/rpc/openai_chat_relay')){
   const b=JSON.parse(String(init?.body));actions.push(b.p_action);
   return Response.json(b.p_action==='claim'?{action:'start',model:'gpt-6-astra',messages:[{role:'user',content:'frozen synthetic message'}]}:{saved:true});
  }
  assert(url==='https://api.openai.com/v1/chat/completions','unexpected_network_target');providerCalls++;
  return new Response('data: {"choices":[{"delta":{"content":"synthetic reply"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
 };
 try{const r=await openai.fetch(request({userId,requestId,model:'gpt-6-astra'},defaultKey));const body=await r.text();assert(r.status===200&&body.includes('[DONE]'),'missing_successful_completion');assert(actions.join(',')==='inspect,claim,result','receipt_not_persisted');assert(providerCalls===1,'unexpected_duplicate_provider_call');}
 finally{globalThis.fetch=original;}
});

Deno.test('native Doubao stage entry validates frozen model and persists its receipt through real SDK RPC',async()=>{
 const original=globalThis.fetch,actions:string[]=[];let providerCalls=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.startsWith('https://native-test.supabase.invalid/rest/v1/rpc/doubao_text_relay')){
   const b=JSON.parse(String(init?.body));actions.push(b.p_action);
   return Response.json(b.p_action==='result'?{saved:true}:{action:b.p_action==='inspect'?'ready':'start',model:'synthetic-vision',maxOutputTokens:4000,references:[{id:claimId,role:'product'}]});
  }
  assert(url==='https://ark.cn-beijing.volces.com/api/v3/chat/completions','unexpected_network_target');providerCalls++;
  return Response.json({id:'synthetic-receipt',model:'synthetic-vision',usage:{prompt_tokens:1,completion_tokens:1,prompt_tokens_details:{cached_tokens:0}},choices:[{finish_reason:'stop',message:{content:'{}'}}]});
 };
 try{const r=await stage.fetch(request({userId,requestId,claimId,operation:'analysis',prompt:'synthetic-only',images:[{id:claimId,role:'product',dataUrl:'data:image/png;base64,AA=='}]},defaultKey));assert(r.status===200,'native_stage_failed');const body=await r.json();assert(body.providerRequestId==='synthetic-receipt','receipt_missing');assert(actions.join(',')==='inspect,claim,result','durable_attempt_protocol_changed');assert(providerCalls===1,'duplicate_provider_request');}
 finally{globalThis.fetch=original;}
});
