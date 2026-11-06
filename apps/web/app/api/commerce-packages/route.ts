import {z}from'zod';
import {packageRequestSchema,packageOrderViewSchema,packageQuoteResponseSchema}from'@zimage/domain';
import {createSupabaseServerClient}from'@/lib/supabase/server';
import {createSupabaseAdminClient}from'@/lib/supabase/admin';
import {executeRoute,assertTrustedOrigin,requireVerifiedUserId}from'@/server/route-context';
import {ApiRouteError}from'@/server/api-error';
import {creditFailure}from'@/server/credits/credit-service';
import {createPackageRuntime,packageRuntimeReady}from'@/server/commerce-package/package-runtime';
export const runtime='nodejs';
export const maxDuration=120;
const enabled=()=>process.env.ZIMAGE_COMMERCE_PACKAGES_ENABLED==='true';
const unavailable=()=>new ApiRouteError({code:'service_not_ready',status:503,retryable:false,message:'整套服务尚未启用；已有订单仍可恢复。'});
function normalize(error:unknown):never {
 if(error instanceof ApiRouteError||error instanceof z.ZodError)throw error;
 const message=error instanceof Error?error.message:'';
 if(/pending|usage_unverified|already|confirmation|required|changed|conflict|closed/.test(message))throw new ApiRouteError({code:'billing_pending',status:409,retryable:false,message:'原订单待核对或资料已变更，请保留原请求，勿重复购买。'});
 if(/configuration|provider_|package_service/.test(message))throw unavailable();
 throw creditFailure({message});
}
async function boundedJson(request:Request) {
 if(!request.body)throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:'请求需要 JSON 内容。'});
 const reader=request.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;if(bytes>32768)throw new ApiRouteError({code:'bad_request',status:413,retryable:false,message:'请求内容过大。'});text+=decoder.decode(p.value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 try{return JSON.parse(text);}catch{throw new ApiRouteError({code:'bad_request',status:400,retryable:false,message:'JSON 格式无效。'});}
}
export async function GET(request:Request) {
 return executeRoute(async()=>{
  const userId=await requireVerifiedUserId(await createSupabaseServerClient());
  const url=new URL(request.url),orderId=url.searchParams.get('orderId'),quoteId=url.searchParams.get('quoteId');
  if(!orderId&&!quoteId&&url.searchParams.get('active')!=='1'&&!enabled())return Response.json({enabled:false});
  const service=createPackageRuntime(createSupabaseAdminClient());
  try{
   if(url.searchParams.get('active')==='1')return Response.json({orders:await service.list(userId)});
   if(orderId)return Response.json(packageOrderViewSchema.parse(await service.get(userId,z.uuid().parse(orderId))));
   if(quoteId)return Response.json(packageOrderViewSchema.parse(await service.getByQuote(userId,z.uuid().parse(quoteId))));
   return Response.json({enabled:enabled()&&packageRuntimeReady(await service.config(userId))});
  }catch(error){normalize(error);}
 });
}
export async function POST(request:Request) {
 return executeRoute(async()=>{
  assertTrustedOrigin(request);const userId=await requireVerifiedUserId(await createSupabaseServerClient());
  if(!enabled()) {
   // Cancellation is recovery of an existing authorization, never new provider work.
   const raw=await boundedJson(request);
   if(raw?.action!=='cancel')throw unavailable();
   const input=packageRequestSchema.parse(raw);if(input.action!=='cancel')throw unavailable();
   try{return Response.json(packageOrderViewSchema.parse(await createPackageRuntime(createSupabaseAdminClient()).cancel(userId,input.orderId)));}catch(error){normalize(error);}
  }
  const input=packageRequestSchema.parse(await boundedJson(request));
  const service=createPackageRuntime(createSupabaseAdminClient());
  try{
   if(input.action==='cancel')return Response.json(packageOrderViewSchema.parse(await service.cancel(userId,input.orderId)));
   if(!packageRuntimeReady(await service.config(userId)))throw unavailable();
   const{action,...body}=input;
   if(action==='quote') {
    const cfg=await service.config(userId)as{costs?:{imageModel?:string}}|null;
    if(!('imageModel'in body)||body.imageModel!==cfg?.costs?.imageModel)throw unavailable();
    return Response.json(packageQuoteResponseSchema.parse(await service.quote(userId,body)));
   }
   const result=action==='accept'?await service.accept(userId,body as Extract<typeof input,{action:'accept'}>):action==='analyze'?await service.analyze(userId,body):action==='confirm'?await service.confirm(userId,body):action==='plan'?await service.plan(userId,body):await service.submit(userId,body);
   return Response.json(packageOrderViewSchema.parse(result));
  }catch(error){normalize(error);}
 });
}
