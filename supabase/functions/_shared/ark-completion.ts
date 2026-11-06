interface Input {
 model:string;maxOutputTokens:number;prompt:string;apiKey:string;
 images?:Array<{id:string;role:string;dataUrl:string}>;
}
async function boundedJson(response:Response) {
 if(!response.body)throw Error('package_provider_response_invalid');
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='',bytes=0;
 try {for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
  if(bytes>1048576)throw Error('package_provider_response_too_large');text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();return JSON.parse(text);
 }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
/** Server-only transport. This function makes one attempt; callers must claim a durable stage first. */
export async function requestArkCompletion(input:Input,fetcher:typeof fetch=fetch) {
 if(!input.apiKey.trim() || !input.model.trim() || !Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens<1 || input.maxOutputTokens>256000)throw Error('package_provider_configuration_missing');
 let response:Response;
 try {response=await fetcher('https://ark.cn-beijing.volces.com/api/v3/chat/completions',{
  method:'POST',signal:AbortSignal.timeout(90000),headers:{authorization:`Bearer ${input.apiKey}`,'content-type':'application/json'},
  body:JSON.stringify({model:input.model,stream:false,service_tier:'default',max_tokens:input.maxOutputTokens,thinking:{type:'disabled'},messages:[{role:'system',content:input.prompt},
   ...((input.images?.length??0)>0?[{role:'user',content:input.images!.flatMap(r=>[{type:'text',text:`sourceId=${r.id}; role=${r.role}`},{type:'image_url',image_url:{url:r.dataUrl}}])}]:[])]}),
 });}catch{throw Error('package_provider_outcome_unknown');}
 if(!response.ok)throw Error('package_provider_outcome_unknown');
 const body=await boundedJson(response);
 const text=body.choices?.[0]?.message?.content;
 if(body.choices?.[0]?.finish_reason!=='stop'||typeof text!=='string' || !text || text.length>40000)throw Error('package_provider_response_invalid');
 const u=body.usage,valid=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=256000;
 const usageKnown=body.service_tier==='default'&&u&&valid(u.prompt_tokens)&&valid(u.completion_tokens)&&valid(u.total_tokens)&&u.prompt_tokens+u.completion_tokens===u.total_tokens&&(u.prompt_tokens_details?.cached_tokens===undefined||valid(u.prompt_tokens_details.cached_tokens)&&u.prompt_tokens_details.cached_tokens<=u.prompt_tokens);
 return {text,model:input.model,serviceTier:typeof body.service_tier==='string'?body.service_tier:null,resolvedModel:typeof body.model==='string'?body.model:null,
  providerRequestId:typeof body.id==='string'?body.id:response.headers.get('x-request-id'),
  usage:usageKnown?{cachedInputTokens:u.prompt_tokens_details?.cached_tokens??null,inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens,totalTokens:u.total_tokens}:null};
}
