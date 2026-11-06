import{ChatProviderFailure}from'../chat/chat-providers';
import {z}from'zod';
export interface DoubaoStageInput {
 userId:string;requestId:string;operation:'analysis'|'planning'|'optimize';claimId?:string;
 recoverOnly?:boolean;prompt?:string;input?:unknown;
 images?:Array<{id:string;role:string;dataUrl:string}>;
}
const receiptSchema=z.object({text:z.string().min(1).max(40000),model:z.string().min(1),serviceTier:z.string().nullable().optional(),resolvedModel:z.string().nullable().optional(),providerRequestId:z.string().nullable().optional(),usage:z.object({cachedInputTokens:z.number().int().min(0).nullable(),inputTokens:z.number().int().min(0),outputTokens:z.number().int().min(0),totalTokens:z.number().int().min(0).optional()}).nullable()});
export function doubaoEdgeConfiguration(requireEnabled=true){
 if(requireEnabled&&process.env.ZIMAGE_DOUBAO_EDGE_ENABLED!=='true')throw Error('package_provider_configuration_missing');
 const url=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??'');
 const key=process.env.SUPABASE_SECRET_KEY?.trim();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!key||/^replace_/i.test(key))throw Error('package_provider_configuration_missing');
 return{endpoint:url.origin+'/functions/v1/doubao-text',key};
}
/** One authenticated request. A recovery request can only read an existing receipt. */
export async function requestDoubaoStage(input:DoubaoStageInput,fetcher:typeof fetch=fetch){
 const cfg=doubaoEdgeConfiguration(!input.recoverOnly);let response:Response;
 try{response=await fetcher(cfg.endpoint,{method:'POST',headers:{apikey:cfg.key,'content-type':'application/json'},signal:AbortSignal.timeout(95000),body:JSON.stringify(input)});}catch{throw Error('package_provider_outcome_unknown');}

 if(!response.body)throw Error('package_provider_response_invalid');
 const reader=response.body.getReader(),decoder=new TextDecoder();let raw='',bytes=0;
 try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>300000)throw Error('package_provider_response_invalid');raw+=decoder.decode(p.value,{stream:true});}raw+=decoder.decode();}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 if(raw.length>100000)throw Error('package_provider_response_invalid');
 if(!response.ok){let body:unknown;try{body=JSON.parse(raw);}catch{}if(input.operation==='optimize'&&(body as {error?:string})?.error==='relay_not_started')throw new ChatProviderFailure('provider_unavailable',false,'rejected');throw Error('package_provider_outcome_unknown');}
 return receiptSchema.parse(JSON.parse(raw));
}
