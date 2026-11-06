import { z } from 'zod';
import { tokenCostNano, type CommercePackageQuote } from './commerce-package-pricing';
import type { PackageOrder } from './commerce-package-order';
export interface PackageImageMetering {
 source:'provider_response';model:string;resolvedModel:string;providerRequestId:string;generatedImages:number;inputReferences:number;outputWidth:number;outputHeight:number;
}
const proof=z.object({source:z.literal('provider_response'),model:z.string().min(1),resolvedModel:z.string().min(1),providerRequestId:z.string().min(1).max(200),generatedImages:z.literal(1),inputReferences:z.number().int().min(0).max(10),outputWidth:z.number().int().min(1).max(8192),outputHeight:z.number().int().min(1).max(8192)});
const textReceipt=z.object({model:z.string().min(1),serviceTier:z.string().nullable().optional(),resolvedModel:z.string().min(1),providerRequestId:z.string().min(1).max(200),usage:z.object({cachedInputTokens:z.number().int().min(0).nullable().optional(),inputTokens:z.number().int().min(0).max(256000),outputTokens:z.number().int().min(0).max(256000),totalTokens:z.number().int().min(0).max(512000).optional()})});
const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
export interface PackageSettlement {captureMinor:number;releaseMinor:number;pendingMinor:number;reviewReason?:string}
export function packageTextUsage(q:CommercePackageQuote,key:'analysis'|'planning',result:unknown):{costNano:bigint}|{reviewReason:string} {
 const r=textReceipt.safeParse(result),vision=key==='analysis',c=q.costs;
 if(c.visionMaxInputTokens>32000||c.plannerMaxInputTokens>32000)return{reviewReason:'price_tier_unverified'};
 if(!r.success || r.data.model!==(vision?c.visionModel:c.plannerModel) || !(vision?c.visionResponseModels:c.plannerResponseModels)?.includes(r.data.resolvedModel))return{reviewReason:'usage_unverified'};
 if(r.data.serviceTier!==undefined&&r.data.serviceTier!=='default')return{reviewReason:'price_tier_unverified'};
 if(r.data.usage.totalTokens!==undefined&&r.data.usage.inputTokens+r.data.usage.outputTokens!==r.data.usage.totalTokens)return{reviewReason:'usage_unverified'};
 if(r.data.usage.cachedInputTokens!==0)return{reviewReason:'cache_usage_unverified'};
 if(r.data.usage.inputTokens>(vision?c.visionMaxInputTokens:c.plannerMaxInputTokens)||r.data.usage.outputTokens>(vision?c.visionMaxOutputTokens:c.plannerMaxOutputTokens))return{reviewReason:'usage_budget_exceeded'};
 return{costNano:tokenCostNano(r.data.usage.inputTokens,r.data.usage.outputTokens,vision?c.visionInputPerMillionNano:c.plannerInputPerMillionNano,vision?c.visionOutputPerMillionNano:c.plannerOutputPerMillionNano)};
}
/** Legacy settlement from returned usage and frozen estimate rates; not supplier invoice proof. */
export function calculatePackageActualSettlement(order:PackageOrder):PackageSettlement {
 const q=order.quote,images=order.stages.filter(s=>s.kind==='image'),total=q.totalMinor;
 const pending=(reviewReason:string):PackageSettlement=>({captureMinor:0,releaseMinor:0,pendingMinor:total,reviewReason});
 if(images.some(s=>!['succeeded','failed','skipped'].includes(s.status)))return pending('image_result_pending');
 const delivered=images.filter(s=>s.status==='succeeded');
 if(!delivered.length)return{captureMinor:0,releaseMinor:total,pendingMinor:0};
 if(!q.sale.sharedCostPolicy || !q.sale.minimumPolicy || !q.costs.imagePixelThreshold)return pending('settlement_policy_missing');
 let shared=0n,imageCost=0n;
 for(const key of ['analysis','planning']as const) {
  const s=order.stages.find(s=>s.key===key);
  if(s?.status!=='succeeded')return pending('usage_unverified');
  const receipt=packageTextUsage(q,key,s.result);if('reviewReason'in receipt)return pending(receipt.reviewReason);
  shared+=receipt.costNano;
 }
 for(const s of delivered) {
  const m=proof.safeParse(s.metering);
  if(!m.success || m.data.model!==q.costs.imageModel || !q.costs.imageResponseModels?.includes(m.data.resolvedModel) || m.data.inputReferences>q.selection.referenceCount)return pending('usage_unverified');
  const rate=m.data.outputWidth*m.data.outputHeight<=q.costs.imagePixelThreshold?q.costs.imageOutputLowNano:q.costs.imageOutputNano;
  if(rate===undefined)return pending('usage_price_unavailable');
  imageCost+=BigInt(rate)+BigInt(Math.max(0,m.data.inputReferences-1))*BigInt(q.costs.extraReferenceNano);
 }
 const count=BigInt(images.length),success=BigInt(delivered.length);
 const divisor=q.sale.sharedCostPolicy==='prorated_to_selected'?count:1n;
 const numerator=q.sale.sharedCostPolicy==='prorated_to_selected'?shared*success+imageCost*count:shared+imageCost;
 const computed=ceil(numerator*BigInt(10000+q.sale.markupBps),divisor*10000n*10000000n);
 const floor=q.sale.minimumPolicy==='prorated_to_successful_outputs'?ceil(BigInt(q.sale.minimumMinor)*success,count):BigInt(q.sale.minimumMinor);
 const charge=computed>floor?computed:floor;
 if(charge>BigInt(total) || charge>BigInt(Number.MAX_SAFE_INTEGER))return pending('cost_exceeds_authorized_cap');
 return{captureMinor:Number(charge),releaseMinor:total-Number(charge),pendingMinor:0};
}

/** Operational estimate from recorded usage and a frozen rate version, never an invoice. */
export function estimatePackageSupplierCost(order:PackageOrder):{basis:'configured_usage_estimate';costVersion:string;estimatedCostNano?:string;reviewReason?:string}{
 const base={basis:'configured_usage_estimate' as const,costVersion:order.quote.costVersion},c=order.quote.costs;
 const pending=(reviewReason:string)=>({...base,reviewReason});let total=0n;
 for(const key of ['analysis','planning']as const){
  const stage=order.stages.find(s=>s.key===key);
  if(!stage)return pending('usage_unverified');
  if((stage.status==='pending'||stage.status==='skipped')&&!stage.claimId)continue;
  if(stage.status!=='succeeded')return pending('supplier_cost_outcome_unverified');
  const result=packageTextUsage(order.quote,key,stage.result);if('reviewReason'in result)return pending(result.reviewReason);total+=result.costNano;
 }
 for(const stage of order.stages.filter(s=>s.kind==='image')){
  if((stage.status==='pending'||stage.status==='skipped')&&!stage.generationId)continue;
  if(stage.status!=='succeeded')return pending('supplier_cost_outcome_unverified');
  const m=proof.safeParse(stage.metering);
  if(!m.success||m.data.model!==c.imageModel||!c.imageResponseModels?.includes(m.data.resolvedModel)||!c.imagePixelThreshold||m.data.inputReferences>order.quote.selection.referenceCount)return pending('usage_unverified');
  const rate=m.data.outputWidth*m.data.outputHeight<=c.imagePixelThreshold?c.imageOutputLowNano:c.imageOutputNano;
  if(rate===undefined)return pending('usage_price_unavailable');
  total+=BigInt(rate)+BigInt(Math.max(0,m.data.inputReferences-1))*BigInt(c.extraReferenceNano);
 }return{...base,estimatedCostNano:total.toString()};
}
