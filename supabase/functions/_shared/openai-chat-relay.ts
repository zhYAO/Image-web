interface Admin {rpc(name:string,input:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
interface Dependencies {provider?:'openai'|'doubao';authorized:boolean;admin:Admin;env:(name:string)=>string|undefined;fetcher:typeof fetch}
const frame=(content:string,finish=false)=>'data: '+JSON.stringify({choices:[{delta:finish?{}:{content},finish_reason:finish?'stop':null}]})+'\n\n';
/** Only the secret-authenticated entry may set authorized. No caller prompt is accepted. */
export async function handleOpenAIChat(request:Request,d:Dependencies):Promise<Response>{
 if(!d.authorized)return Response.json({error:'unauthorized'},{status:401});
 if(request.method!=='POST')return new Response(null,{status:405});
 const doubao=d.provider==='doubao';
 if(d.env(doubao?'ZIMAGE_DOUBAO_EDGE_ENABLED':'ZIMAGE_OPENAI_ENABLED')!=='true')return Response.json({error:'unavailable'},{status:503});
 const key=d.env(doubao?'ARK_API_KEY':'OPENAI_API_KEY')?.trim();
 const physicalModel=doubao?d.env('ZIMAGE_DOUBAO_CHAT_MODEL')?.trim():undefined;
 const configured=d.env(doubao?'ZIMAGE_DOUBAO_EDGE_ENABLED':'ZIMAGE_OPENAI_ENABLED')==='true'&&key&&!/^replace_/i.test(key)&&(!doubao||physicalModel&&!/^replace_/i.test(physicalModel));
 if(!doubao&&!configured)return Response.json({error:'unavailable'},{status:503});
 let body:Record<string,unknown>;
 try{if(!request.body)throw Error();const reader=request.body.getReader();let bytes=0,text='';const dec=new TextDecoder();
 try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>1024)throw Error();text+=dec.decode(p.value,{stream:true});}text+=dec.decode();}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 body=JSON.parse(text);const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!body||Object.keys(body).some(k=>!['userId','requestId','model'].includes(k))||!uuid.test(String(body.userId))||!uuid.test(String(body.requestId))||!(doubao?['doubao']:['gpt-6-astra','gpt-6.1-sol']).includes(String(body.model)))throw Error();
 }catch{return Response.json({error:'invalid_request'},{status:400});}
 const call=async(action:string,content?:string)=>{const r=await d.admin.rpc(doubao?'doubao_chat_relay':'openai_chat_relay',{p_user_id:body.userId,p_request_id:body.requestId,p_model:body.model,p_action:action,...(content===undefined?{}:{p_content:content})});if(r.error||!r.data)throw Error('relay_pending');return r.data as {action:string;model:string;messages:Array<{role:string;content:string}>;content?:string;notStarted?:boolean;billingMode?:string;physicalModel?:string;maxInputTokens?:number;maxOutputTokens?:number};};
 if(!configured){try{const proof=await call('reject_not_started');if(proof.notStarted===true)return Response.json({error:'relay_not_started'},{status:503});}catch{/* Missing or ambiguous proof cannot authorize a refund. */}return Response.json({error:'relay_pending'},{status:503});}
 let claim:Awaited<ReturnType<typeof call>>;try{const preflight=await call('inspect');if(preflight.action==='ready'&&preflight.billingMode==='usage_capped'&&(!Number.isInteger(preflight.maxInputTokens)||!Array.isArray(preflight.messages)||new TextEncoder().encode(JSON.stringify(preflight.messages)).length+1024>preflight.maxInputTokens!)){const proof=await call('reject_not_started');return Response.json({error:proof.notStarted===true?'relay_not_started':'relay_pending'},{status:503});}claim=await call('claim');}catch{return Response.json({error:'relay_pending'},{status:503});}
 const encoder=new TextEncoder(),headers={'content-type':'text/event-stream','cache-control':'no-store'};
 if(claim.action==='replay'&&typeof claim.content==='string')return new Response(frame(claim.content)+frame('',true)+'data: [DONE]\n\n',{headers});
 if(claim.action!=='start'||claim.model!==body.model||!Array.isArray(claim.messages))return Response.json({error:'relay_pending'},{status:503});
 return new Response(new ReadableStream({async start(controller){
  const emit=(s:string)=>controller.enqueue(encoder.encode(s));let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let content='',finish:string|undefined,usage:Record<string,unknown>|undefined,resolvedModel:string|undefined,providerRequestId:string|undefined,checkpointAttempted=false;
  const tokenBilling=claim.billingMode==='usage_capped';
  const receipt=()=>{const n=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=272000?v:undefined;const inputTokens=n(usage?.prompt_tokens),outputTokens=n(usage?.completion_tokens),totalTokens=n(usage?.total_tokens),cachedInputTokens=n((usage?.prompt_tokens_details as Record<string,unknown>|undefined)?.cached_tokens);return ['stop','length'].includes(finish??'')&&providerRequestId&&resolvedModel&&inputTokens!==undefined&&outputTokens!==undefined&&totalTokens!==undefined&&cachedInputTokens!==undefined&&inputTokens+outputTokens===totalTokens&&cachedInputTokens<=inputTokens?{providerRequestId,resolvedModel,finishReason:finish,inputTokens,outputTokens,totalTokens,cachedInputTokens}:null;};
  const save=async()=>{checkpointAttempted=true;await call(tokenBilling?'usage_result':'result',tokenBilling?JSON.stringify({content,receipt:receipt()}):content);};
  try{
   const tokenBilling=claim.billingMode==='usage_capped';
   const model=tokenBilling?claim.physicalModel:(doubao?physicalModel:claim.model);if(!model||/^replace_/i.test(model))throw Error('configuration_missing');
   if(tokenBilling&&(!Number.isInteger(claim.maxInputTokens)||!Number.isInteger(claim.maxOutputTokens)||claim.maxOutputTokens!<1||claim.maxOutputTokens!>16000))throw Error('frozen_token_budget_invalid');
   const response=await d.fetcher(doubao?'https://ark.cn-beijing.volces.com/api/v3/chat/completions':'https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model,messages:claim.messages,stream:true,stream_options:{include_usage:true},...(doubao?{max_tokens:tokenBilling?claim.maxOutputTokens:16000,thinking:{type:'disabled'}}:{max_completion_tokens:tokenBilling?claim.maxOutputTokens:16000})}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(45000)])});
   if(!response.ok||!response.body)throw Error('upstream_unknown');
   reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',done=false;
   while(!done){const part=await reader.read();if(part.done)throw Error('upstream_incomplete');buffer=(buffer+decoder.decode(part.value,{stream:true})).replaceAll('\r\n','\n');if(buffer.length>131072)throw Error('upstream_invalid');
    const frames=buffer.split('\n\n');buffer=frames.pop()??'';
    for(const f of frames){const payload=f.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!payload)continue;if(payload==='[DONE]'){if(!tokenBilling||!finish||!content)throw Error('upstream_incomplete');await save();emit(frame('',true)+'data: [DONE]\n\n');done=true;break;}
     const value=JSON.parse(payload);if(value.error)throw Error('upstream_unknown');if(typeof value.model==='string'&&value.model.length<=100)resolvedModel=value.model;if(typeof value.id==='string'&&value.id.length<=200)providerRequestId=value.id;if(value.usage&&typeof value.usage==='object'&&!Array.isArray(value.usage))usage=value.usage;const choice=value.choices?.[0];if(!choice)continue;
     const delta=choice.delta?.content;if(typeof delta==='string'){content+=delta;if(content.length>64000)throw Error('upstream_too_large');emit(frame(delta));}
     if(choice.finish_reason==='stop'||tokenBilling&&choice.finish_reason==='length'){if(!content)throw Error('upstream_empty');finish=choice.finish_reason;if(!tokenBilling){await save();emit(frame('',true)+'data: [DONE]\n\n');done=true;break;}}
     else if(choice.finish_reason)throw Error('upstream_incomplete');
    }
   }controller.close();
  }catch{if(tokenBilling&&content&&!checkpointAttempted)try{await save();}catch{/* A lost receipt remains recoverable; no supplier retry. */}controller.error(Error('relay_outcome_unknown'));}
  finally{if(reader){await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
 }}),{headers});
}
