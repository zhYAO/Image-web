import type{SupabaseClient}from'@supabase/supabase-js';
import {commercePackageConfigSchema,parseCreativeStrategy,type CommercePackageConfig}from'@zimage/domain';
import {loadOwnedAnalysisReferences}from'../commerce-analysis/owned-references';
import {analyzeCommerceImages}from'../commerce-analysis/analysis-service';
import {optimizeCreativeText}from'../creative-text/creative-text-service';
import {requestDoubaoStage,doubaoEdgeConfiguration}from'./package-providers';
import {createCommercePackageService,type PackageModelResult,type PackageRecord}from'./package-service';
export function packageRuntimeReady(raw:unknown) {
 const cfg=commercePackageConfigSchema.safeParse(raw);if(!cfg.success)return false;
 return cfg.data.costs.visionMaxInputTokens<=32000&&cfg.data.costs.plannerMaxInputTokens<=32000&&cfg.data.sale.settlement==='fixed_images'&&cfg.data.costs.imageResolution==='2K'&&Boolean(cfg.data.sale.priceEvidence)&&Boolean(cfg.data.sale.imagePrices)&&cfg.data.sale.sharedCostPolicy==='include_once_if_any_success'&&cfg.data.sale.minimumPolicy==='whole_order'&&cfg.data.costs.imageOutputLowNano!==undefined&&cfg.data.costs.imageModel==='doubao-seedream-5.0-pro'&&(()=>{try{doubaoEdgeConfiguration();return true;}catch{return false;}})();
}
export function createPackageRuntime(admin:SupabaseClient,fetcher:typeof fetch=fetch) {
 const request=(r:PackageRecord,key:'analysis'|'planning',prompt:string,images?:Array<{id:string;role:string;dataUrl:string}>)=>
  requestDoubaoStage({userId:r.state.userId,requestId:r.state.id,operation:key,claimId:r.state.stages.find(s=>s.key===key)?.claimId,prompt,...(images?{images}:{})},fetcher);
 return createCommercePackageService(admin,{
  recover:async(r,key)=>{
   const receipt=await requestDoubaoStage({userId:r.state.userId,requestId:r.state.id,operation:key,claimId:r.state.stages.find(s=>s.key===key)?.claimId,recoverOnly:true},fetcher);
   if(key==='analysis'){
    const data=await analyzeCommerceImages({requestId:r.state.id,sessionId:r.state.sessionId,references:r.references},{authorize:async()=>r.references.map(x=>({...x,dataUrl:''})),model:async()=>receipt.text});
    return{...receipt,data};
   }
   const review=r.state.review;if(!review)throw Error('facts_confirmation_required');
   const value=await optimizeCreativeText({field:'strategy',chatModel:'doubao',text:JSON.stringify({modules:r.state.quote.selection.modules}),expectedModules:r.state.quote.selection.modules,productContext:{name:review.name,facts:review.facts,designStyle:review.styleSummary,platform:review.platform,region:review.region,language:review.language},maxLength:4000},async function*(){yield receipt.text;});
   return{...receipt,data:parseCreativeStrategy(JSON.parse(value.text),r.state.quote.selection.modules)};
  },
  authorize:r=>loadOwnedAnalysisReferences(admin,r.state.userId,{requestId:r.state.id,sessionId:r.state.sessionId,references:r.references.map(({id,role})=>({id,role}))}),
  analyze:async(r,images)=>{
   let receipt:Awaited<ReturnType<typeof requestDoubaoStage>>|undefined;
   const data=await analyzeCommerceImages({requestId:r.state.id,sessionId:r.state.sessionId,references:r.references.map(({id,role})=>({id,role}))},{authorize:async()=>images,model:async prompt=>{receipt=await request(r,'analysis',prompt,images);return receipt.text;}});
   if(!receipt)throw Error('package_provider_response_invalid');return {...receipt,data};
  },
  plan:async r=>{
   const review=r.state.review;if(!review)throw Error('facts_confirmation_required');
   let receipt:Awaited<ReturnType<typeof requestDoubaoStage>>|undefined;
   const value=await optimizeCreativeText({field:'strategy',chatModel:'doubao',text:JSON.stringify({modules:r.state.quote.selection.modules}),expectedModules:r.state.quote.selection.modules,productContext:{name:review.name,facts:review.facts,designStyle:review.styleSummary,platform:review.platform,region:review.region,language:review.language},maxLength:4000},async function*(prompt){receipt=await request(r,'planning',prompt);yield receipt.text;});
   if(!receipt)throw Error('package_provider_response_invalid');
   return {...receipt,data:parseCreativeStrategy(JSON.parse(value.text),r.state.quote.selection.modules)}as PackageModelResult;
  },
 });
}
export type PackageCostConfiguration=CommercePackageConfig;
