import{requestArkCompletion}from'./ark-completion.ts';
interface Admin{rpc(name:string,input:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>}
interface Dependencies{authorized:boolean;admin:Admin;env:(name:string)=>string|undefined;fetcher:typeof fetch}
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export async function handleDoubaoText(request:Request,d:Dependencies):Promise<Response>{
 if(!d.authorized)return Response.json({error:'unauthorized'},{status:401});
 if(request.method!=='POST')return new Response(null,{status:405});
 let b:Record<string,unknown>;
 try{
  if(!request.body)throw Error();const reader=request.body.getReader(),dec=new TextDecoder();let n=0,s='';
  try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.byteLength;if(n>24*1024*1024)throw Error();s+=dec.decode(p.value,{stream:true});}s+=dec.decode();}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  b=JSON.parse(s);if(!b||Object.keys(b).some(k=>!['userId','requestId','operation','claimId','recoverOnly','prompt','images','input'].includes(k))||!uuid(b.userId)||!uuid(b.requestId)||!['analysis','planning','optimize'].includes(String(b.operation)))throw Error();
  if(b.operation!=='optimize'&&!uuid(b.claimId))throw Error();
  if(b.recoverOnly!==undefined&&typeof b.recoverOnly!=='boolean')throw Error();
  if(b.recoverOnly===true){if(b.prompt!==undefined||b.images!==undefined||b.input!==undefined)throw Error();}
  else{
   if(typeof b.prompt!=='string'||b.prompt.length<1||b.prompt.length>40000)throw Error();
   if(b.operation==='optimize'&&(!b.input||typeof b.input!=='object'))throw Error();
   const images=b.images??[];if(!Array.isArray(images)||images.length>10||b.operation!=='analysis'&&images.length)throw Error();
   for(const i of images){if(!i||Object.keys(i).some(k=>!['id','role','dataUrl'].includes(k))||!uuid(i.id)||!['product','style'].includes(i.role)||typeof i.dataUrl!=='string'||i.dataUrl.length>5600000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(i.dataUrl))throw Error();}
  }
 }catch{return Response.json({error:'invalid_request'},{status:400});}
 const recover=b.recoverOnly===true;
 if(!recover&&d.env('ZIMAGE_DOUBAO_EDGE_ENABLED')!=='true')return Response.json({error:'unavailable'},{status:503});
 // Reading a receipt must remain possible when future supplier calls are disabled.
 const key=recover?undefined:d.env('ARK_API_KEY')?.trim();

 const images=(b.images??[])as Array<{id:string;role:string;dataUrl:string}>;
 const hash=recover?undefined:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({prompt:b.prompt,images}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const payload={claimId:b.claimId,payloadHash:hash,input:b.input,references:images.map(({id,role})=>({id,role}))};
 const call=async(action:string,receipt?:unknown)=>{const r=await d.admin.rpc('doubao_text_relay',{p_user_id:b.userId,p_request_id:b.requestId,p_operation:b.operation,p_action:action,p_payload:{...payload,...(receipt?{receipt}:{})}});if(r.error||!r.data)throw Error('relay_pending');return r.data as {action:string;model:string;maxOutputTokens:number;references?:unknown;receipt?:unknown;notStarted?:boolean};};
 const notStarted=async()=>{
  if(b.operation==='optimize')try{const proof=await call('reject_not_started');if(proof.notStarted===true)return Response.json({error:'relay_not_started'},{status:503});}catch{/* A competing attempt or missing evidence stays unknown. */}
  return Response.json({error:'relay_outcome_unknown'},{status:503});
 };
 if(!recover&&(d.env('ZIMAGE_DOUBAO_EDGE_ENABLED')!=='true'||!key||/^replace_/i.test(key)))return notStarted();
 try{
  const c=await call(recover?'read':'inspect');if(c.action==='replay'&&c.receipt)return Response.json(c.receipt,{headers:{'cache-control':'no-store'}});
  if(recover||c.action!=='ready')throw Error();
  const expected=d.env(b.operation==='analysis'?'ZIMAGE_DOUBAO_VISION_MODEL':b.operation==='planning'?'ZIMAGE_DOUBAO_PLANNER_MODEL':'ZIMAGE_DOUBAO_CHAT_MODEL')?.trim();
  if(b.operation==='optimize')c.model=expected??'';
  if(!expected||/^replace_/i.test(expected)||c.model!==expected)return notStarted();
  if(b.operation==='analysis'&&JSON.stringify(c.references)!==JSON.stringify(payload.references))throw Error();
  const claimed=await call('claim');
  if(claimed.action==='replay'&&claimed.receipt)return Response.json(claimed.receipt,{headers:{'cache-control':'no-store'}});
  if(claimed.action!=='start'||claimed.maxOutputTokens!==c.maxOutputTokens||b.operation!=='optimize'&&claimed.model!==c.model)throw Error();
  const receipt=await requestArkCompletion({model:c.model,maxOutputTokens:c.maxOutputTokens,prompt:b.prompt as string,images,apiKey:key!},d.fetcher);
  await call('result',receipt);
  return Response.json(receipt,{headers:{'cache-control':'no-store'}});
 }catch{return Response.json({error:'relay_outcome_unknown'},{status:503});}
}
