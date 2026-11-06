import { expect,it } from 'vitest';
import { buildCommercePackageQuote } from '../src/commerce-package-pricing';
import { createPackageOrder } from '../src/commerce-package-order';
import { calculatePackageActualSettlement } from '../src/commerce-package-metering';
import { packagePriceFixture } from './commerce-package-fixture';
const config=()=>({...packagePriceFixture,costs:{...packagePriceFixture.costs,imageOutputLowNano:'300000000',imagePixelThreshold:2610000,imageResponseModels:['fixture-image'],visionResponseModels:['fixture-vision'],plannerResponseModels:['fixture-plan']},sale:{...packagePriceFixture.sale,settlement:'actual_capped',sharedCostPolicy:'prorated_to_selected',minimumPolicy:'prorated_to_successful_outputs'}});
function order() {
 const q=buildCommercePackageQuote(config(),{modules:['品牌首屏','核心卖点'],advanced:false,referenceCount:1});
 const o=createPackageOrder({id:'test',userId:'user',sessionId:'session',referenceSignature:'refs',quote:q});
 o.status='completed';o.stages.forEach(s=>s.status='succeeded');
 o.stages[0]!.result={model:q.costs.visionModel,resolvedModel:q.costs.visionModel,providerRequestId:'analysis-receipt',usage:{cachedInputTokens:0,inputTokens:20000,outputTokens:4000}};
 o.stages[1]!.result={model:q.costs.plannerModel,resolvedModel:q.costs.plannerModel,providerRequestId:'plan-receipt',usage:{cachedInputTokens:0,inputTokens:10000,outputTokens:4000}};
 for(const s of o.stages.filter(s=>s.kind==='image'))s.metering={source:'provider_response',model:q.costs.imageModel,resolvedModel:q.costs.imageModel,providerRequestId:s.key,generatedImages:1,inputReferences:1,outputWidth:2048,outputHeight:2048};
 return o;
}
it('settles verified usage below the cap and releases unused budget',()=>{
 const o=order();o.stages[0]!.result={model:o.quote.costs.visionModel,resolvedModel:o.quote.costs.visionModel,providerRequestId:'a',usage:{cachedInputTokens:0,inputTokens:1000,outputTokens:100}};
 o.stages[1]!.result={model:o.quote.costs.plannerModel,resolvedModel:o.quote.costs.plannerModel,providerRequestId:'p',usage:{cachedInputTokens:0,inputTokens:500,outputTokens:100}};
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:241,releaseMinor:9,pendingMinor:0});
});
it('does not guess missing usage or substitute the frozen estimate',()=>{
 const o=order();delete o.stages[2]!.metering;
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,releaseMinor:0,pendingMinor:250,reviewReason:'usage_unverified'});
});
it('stops automatic settlement when usage exceeds the authorized input budget',()=>{
 const o=order();(o.stages[0]!.result as {usage:{cachedInputTokens:0,inputTokens:number}}).usage.inputTokens=20001;
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,pendingMinor:250,reviewReason:'usage_budget_exceeded'});
});
it('requires explicit policies for shared cost and minimum in a partially completed order',()=>{
 const cfg=config();delete (cfg.sale as Partial<typeof cfg.sale>).sharedCostPolicy;expect(()=>buildCommercePackageQuote(cfg,{modules:['品牌首屏'],advanced:false,referenceCount:1})).toThrow();
});
it('supports explicit proportional shared costs and charges only delivered outputs',()=>{
 const o=order();o.stages[3]!.status='failed';expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:125,releaseMinor:125,pendingMinor:0});
});
it('supports the alternate shared-cost policy only when explicitly configured',()=>{
 const cfg=config();cfg.sale.sharedCostPolicy='include_once_if_any_success';const o=order();
 o.quote=buildCommercePackageQuote(cfg,o.quote.selection);o.stages[3]!.status='failed';
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:130,releaseMinor:120,pendingMinor:0});
});
it('uses the actual returned size tier rather than the requested export size',()=>{
 const o=order();o.stages[2]!.metering!.outputWidth=1280;o.stages[2]!.metering!.outputHeight=720;
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:190,releaseMinor:60,pendingMinor:0});
});
it('returns everything when there are no delivered images regardless of text costs',()=>{
 const o=order();for(const s of o.stages.filter(s=>s.kind==='image')){s.status='failed';delete s.metering;}
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,releaseMinor:250,pendingMinor:0});
});
it('treats an in-flight image as pending even when another is delivered',()=>{
 const o=order();o.stages[3]!.status='unknown';expect(calculatePackageActualSettlement(o).pendingMinor).toBe(250);
});

it('does not bill an unrecognized model even when requested model matches the price profile',()=>{
 const o=order();o.stages[2]!.metering={...o.stages[2]!.metering!,resolvedModel:'unapproved-model'};
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,pendingMinor:250,reviewReason:'usage_unverified'});
});

it.each([undefined,1])('holds settlement when cache accounting cannot use the verified full-input tariff (%s)',cached=>{
 const o=order();const receipt=o.stages[0]!.result as {usage:Record<string,unknown>};receipt.usage.cachedInputTokens=cached;
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,pendingMinor:250,reviewReason:'cache_usage_unverified'});
});

it('holds actual settlement when the configured text budget crosses the verified flat-price input tier',()=>{
 const o=order();o.quote.costs.visionMaxInputTokens=40000;
 expect(calculatePackageActualSettlement(o)).toMatchObject({captureMinor:0,releaseMinor:0,pendingMinor:o.quote.totalMinor,reviewReason:'price_tier_unverified'});
});
it('separates the frozen-rate supplier estimate from customer sale settlement',async()=>{
 const {estimatePackageSupplierCost}=await import('../src/commerce-package-metering');const o=order();const estimate=estimatePackageSupplierCost(o);expect(estimate).toEqual({basis:'configured_usage_estimate',costVersion:o.quote.costVersion,estimatedCostNano:'1246800000'});
 o.stages[0]!.result={text:'complete',usage:null};expect(estimatePackageSupplierCost(o)).toMatchObject({reviewReason:'usage_unverified'});
 expect(estimatePackageSupplierCost(o).estimatedCostNano).toBeUndefined();
});
it('does not call a failed or unknown supplier attempt free during cost auditing',async()=>{
 const {estimatePackageSupplierCost}=await import('../src/commerce-package-metering');const o=order();o.stages[3]!.status='failed';expect(estimatePackageSupplierCost(o)).toMatchObject({reviewReason:'supplier_cost_outcome_unverified'});
});
