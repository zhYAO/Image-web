import { z } from 'zod';
import {
  assertPackageSnapshot, canonicalPackageJson, claimPackageStage, confirmPackageFacts,
  markPackageUnknown, packageSettlement, packageTextUsage, estimatePackageSupplierCost, recordPackageResult, commerceAnalysisResultSchema,
  parseCreativeStrategy, type PackageOrder, type CommercePackageQuote,
} from '@zimage/domain';
import type { CreditRpc } from '@/server/credits/credit-service';

const referenceSchema=z.object({id:z.uuid(),role:z.enum(['product','style'])}).strict();
const actionSchema=z.object({orderId:z.uuid(),references:z.array(referenceSchema).min(1).max(10)}).strict();
export type PackageReference=z.infer<typeof referenceSchema>;
export interface PackageRecord {state:PackageOrder;revision:number;settled:boolean;references:PackageReference[]}
export interface PackageModelResult {data:unknown;usage:unknown;model:string;resolvedModel?:string|null;providerRequestId?:string|null}
interface Dependencies {
  recover?:(record:PackageRecord,key:'analysis'|'planning')=>Promise<PackageModelResult>;
  authorize:(record:PackageRecord)=>Promise<Array<PackageReference & {dataUrl:string}>>;
  analyze:(record:PackageRecord,images:Array<PackageReference & {dataUrl:string}>)=>Promise<PackageModelResult>;
  plan:(record:PackageRecord)=>Promise<PackageModelResult>;
}
export function publicPackageQuote(q:CommercePackageQuote) {
  return {imageModel:q.costs.imageModel,...(q.costs.imageResolution?{imageResolution:q.costs.imageResolution}:{}),totalMinor:q.totalMinor,minimumMinor:q.sale.minimumMinor,settlementMode:q.sale.settlement,outputCount:q.outputCount,selection:q.selection,
    imagePrices:q.stages.filter(s=>s.kind==='image').map((s,i)=>({key:s.key,amountMinor:s.amountMinor,
      module:q.selection.modules[i%q.selection.modules.length]!,
      spec:q.selection.advanced?(i<q.selection.modules.length?'desktop':'mobile'):'standard'})),
    rule:q.sale.settlement==='fixed_images'
      ?'按本单已确认的模型、规格和固定图片单价收取成功图片费用；分析和策划包含其中，不单独收费。出图前取消全退，明确失败图片不收费；至少一张成功时整单最低'+(q.sale.minimumMinor/100).toFixed(2)+'积分。未知结果先核对，剩余预算退回。单价按已确认成本估值及加价'+q.sale.markupBps/100+'%形成，供应商用量仅用于后台成本估算，不代表最终实付账单。'
      :'本历史订单按原报价快照结算；加价'+q.sale.markupBps/100+'%，有成功图片最低'+(q.sale.minimumMinor/100).toFixed(2)+'积分。用量与冻结成本费率用于成本估值，不代表供应商最终实付账单。出图前取消全退，未知结果先核对。'
};
}
function publicOrder(r:PackageRecord) {
  const o=r.state,a=o.stages.find(s=>s.key==='analysis'),p=o.stages.find(s=>s.key==='planning');
  const billingReviewReason=o.quote.sale.settlement==='actual_capped'?(['analysis','planning']as const).flatMap(key=>{const s=o.stages.find(s=>s.key===key);if(s?.status!=='succeeded')return[];const r=packageTextUsage(o.quote,key,s.result);return'reviewReason'in r?[r.reviewReason]:[];})[0]:undefined;
  const costReviewReason=o.quote.sale.settlement==='fixed_images'?estimatePackageSupplierCost(o).reviewReason:undefined;
  return {billingReviewReason,costReviewReason,id:o.id,sessionId:o.sessionId,revision:r.revision,status:o.status,settled:r.settled,quote:publicPackageQuote(o.quote),
    references:r.references.map(({id,role})=>({id,role})),referenceSignature:o.referenceSignature,review:o.review,taskId:o.taskId,
    analysis:a?.status==='succeeded'?commerceAnalysisResultSchema.parse((a.result as PackageModelResult).data):undefined,
    planning:p?.status==='succeeded'?parseCreativeStrategy((p.result as PackageModelResult).data,o.quote.selection.modules):undefined,
    stages:o.stages.map(s=>({key:s.key,kind:s.kind,status:s.status,amountMinor:s.amountMinor,generationId:s.generationId})),
    settlement:packageSettlement(o)};
}
export type PublicPackageOrder=ReturnType<typeof publicOrder>;
export function createCommercePackageService(store:CreditRpc,dependencies:Dependencies) {
  const call=async(userId:string,action:string,input:Record<string,unknown>={})=>{
    z.uuid().parse(userId);
    const r=await store.rpc('commerce_package_dispatch',{p_user_id:userId,p_action:action,p_input:input});
    if(r.error || r.data===null)throw Error(r.error?.message??'package_service_unavailable');return r.data;
  };
  const record=(value:unknown,userId:string):PackageRecord=>{
    const r=value as PackageRecord;
    if(!r?.state || r.state.userId!==userId || !Number.isSafeInteger(r.revision))throw Error('package_not_found');
    assertPackageSnapshot(r.state);return r;
  };
  const load=async(userId:string,orderId:string)=>record(await call(userId,'get',{orderId:z.uuid().parse(orderId)}),userId);
  const save=async(userId:string,r:PackageRecord,state:PackageOrder)=>record(await call(userId,'save',{orderId:state.id,expectedRevision:r.revision,state}),userId);
  const checkReferences=(r:PackageRecord,references:PackageReference[])=>{
    const expected=r.references.map(({id,role})=>({id,role}));
    if(canonicalPackageJson(expected)!==canonicalPackageJson(references))throw Error('package_references_changed');
  };
  const run=async(userId:string,raw:unknown,key:'analysis'|'planning')=>{
    const input=actionSchema.parse(raw),r=await load(userId,input.orderId);
    const s=r.state.stages.find(s=>s.key===key)!;
    // Recovery precedes current model configuration, image expiry or a new claim.
    if(s.status==='succeeded')return publicOrder(r);
    if(s.status==='processing' || s.status==='unknown'){
      if(!dependencies.recover||!s.claimId)throw Error('stage_result_pending');
      const result=await dependencies.recover(r,key);
      if(key==='analysis')commerceAnalysisResultSchema.parse(result.data);else parseCreativeStrategy(result.data,r.state.quote.selection.modules);
      try{return publicOrder(await save(userId,r,recordPackageResult(r.state,key,s.claimId,result)));}
      catch(error){const v=await load(userId,input.orderId);if(v.state.stages.find(x=>x.key===key)?.status==='succeeded')return publicOrder(v);throw error;}
    }
    checkReferences(r,input.references);
    if(key==='planning' && r.state.quote.sale.settlement==='actual_capped' && 'reviewReason'in packageTextUsage(r.state.quote,'analysis',r.state.stages[0]?.result))throw Error('package_usage_unverified');
    const images=await dependencies.authorize(r);
    const claimId=crypto.randomUUID();
    const claimed=await save(userId,r,claimPackageStage(r.state,key,claimId));
    let result:PackageModelResult;
    try {
      result=key==='analysis'?await dependencies.analyze(claimed,images):await dependencies.plan(claimed);
      if(key==='analysis')commerceAnalysisResultSchema.parse(result.data);
      else parseCreativeStrategy(result.data,claimed.state.quote.selection.modules);
    } catch(error) {
      // A request may have reached the supplier. Never re-claim on a timeout or invalid response.
      try {await save(userId,claimed,markPackageUnknown(claimed.state,key,claimId,'provider_outcome_or_result_unknown'));}catch{/* The durable processing claim still prevents re-submission. */}
      throw error;
    }
    try {return publicOrder(await save(userId,claimed,recordPackageResult(claimed.state,key,claimId,result)));}
    catch(error) {
      // A lost result-save response is recovered by reading, never by calling the model again.
      const recovered=await load(userId,input.orderId);
      if(recovered.state.stages.find(s=>s.key===key)?.status==='succeeded' || recovered.state.status==='cancelled')return publicOrder(recovered);
      throw error;
    }
  };
  // Receipt lookup is recovery only. The injected function must never submit work.
  const recoverRecord=async(userId:string,r:PackageRecord)=>{
    if(!dependencies.recover||r.settled||!['active','needs_review'].includes(r.state.status))return r;
    for(const key of ['analysis','planning']as const){
      const s=r.state.stages.find(x=>x.key===key);
      if(!s?.claimId||!['processing','unknown'].includes(s.status))continue;
      try{
        const result=await dependencies.recover(r,key);
        if(key==='analysis')commerceAnalysisResultSchema.parse(result.data);else parseCreativeStrategy(result.data,r.state.quote.selection.modules);
        r=await save(userId,r,recordPackageResult(r.state,key,s.claimId,result));
      }catch{/* No new attempt or refund; absence/unknown remains visible. */}
    }return r;
  };
  return {
    async list(userId:string){return z.array(z.object({id:z.uuid()}).strict()).max(100).parse(await call(userId,'list',{}));},
    async config(userId:string) {try{return await call(userId,'config');}catch{return null;}},
    async quote(userId:string,input:Record<string,unknown>) {
      const q=await call(userId,'quote',input) as {id:string;expires_at:string;snapshot:CommercePackageQuote};
      // Recompute/check the database snapshot before it can become a displayed price.
      const stages=q.snapshot.stages.map(s=>({...s,status:'pending' as const}));
      assertPackageSnapshot({id:q.id,userId,sessionId:String(input.sessionId),referenceSignature:'quote',status:'active',quote:q.snapshot,stages});
      return {id:q.id,expiresAt:q.expires_at,...publicPackageQuote(q.snapshot)};
    },
    async accept(userId:string,input:{quoteId:string;requestId:string;totalMinor:number}) {return publicOrder(record(await call(userId,'accept',input),userId));},
    async get(userId:string,id:string) {return publicOrder(await recoverRecord(userId,await load(userId,id)));},
    async getByQuote(userId:string,quoteId:string){return publicOrder(await recoverRecord(userId,record(await call(userId,'recover_quote',{quoteId:z.uuid().parse(quoteId)}),userId)));},
    analyze:(userId:string,input:unknown)=>run(userId,input,'analysis'),
    plan:(userId:string,input:unknown)=>run(userId,input,'planning'),
    async confirm(userId:string,raw:unknown) {
      const input=actionSchema.extend({name:z.string().min(1).max(160),facts:z.string().min(1).max(4000),styleSummary:z.string().max(2000),platform:z.string().max(80).optional(),region:z.string().max(80).optional(),language:z.string().max(80).optional()}).parse(raw);
      const r=await load(userId,input.orderId);checkReferences(r,input.references);await dependencies.authorize(r);
      const review={name:input.name,facts:input.facts,styleSummary:input.styleSummary,...(input.platform?{platform:input.platform}:{}),...(input.region?{region:input.region}:{}),...(input.language?{language:input.language}:{}),referenceSignature:r.state.referenceSignature};
      const state=confirmPackageFacts(r.state,review);
      if(canonicalPackageJson(state)===canonicalPackageJson(r.state))return publicOrder(r);
      return publicOrder(await save(userId,r,state));
    },
    async submit(userId:string,raw:unknown) {
      const input=actionSchema.extend({taskId:z.uuid(),revision:z.number().int().min(1)}).parse(raw);
      const r=await load(userId,input.orderId);
      if(r.state.taskId) {
        if(r.state.taskId!==input.taskId||r.state.taskRevision!==input.revision)throw Error('idempotency_conflict');return publicOrder(r);
      }
      checkReferences(r,input.references);await dependencies.authorize(r);
      if(r.state.quote.sale.settlement==='actual_capped' && (['analysis','planning']as const).some(key=>'reviewReason'in packageTextUsage(r.state.quote,key,r.state.stages.find(s=>s.key===key)?.result)))throw Error('package_usage_unverified');
      return publicOrder(record(await call(userId,'submit',{orderId:input.orderId,taskId:input.taskId,revision:input.revision}),userId));
    },
    async cancel(userId:string,orderId:string) {return publicOrder(record(await call(userId,'cancel',{orderId:z.uuid().parse(orderId)}),userId));},
  };
}
