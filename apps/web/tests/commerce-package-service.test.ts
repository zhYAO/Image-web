import { describe,expect,it } from 'vitest';
import { buildCommercePackageQuote,createPackageOrder,claimPackageStage,markPackageUnknown,canonicalPackageJson,type PackageOrder } from '@zimage/domain';
import { createCommercePackageService, publicPackageQuote } from '@/server/commerce-package/package-service';
import { packagePriceFixture } from '../../../packages/domain/tests/commerce-package-fixture';
const user='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111',session='33333333-3333-4333-8333-333333333333';
const refs=[{id:'44444444-4444-4444-8444-444444444444',role:'product' as const}];
const analysis={observations:[{sourceId:refs[0]!.id,text:'白色杯身',kind:'visible'}],styleSummary:'',missing:['容量'],conflicts:[]};
function setup(actual=false) {
 const cfg=actual?{...packagePriceFixture,costs:{...packagePriceFixture.costs,imagePixelThreshold:2610000,imageResponseModels:["fixture-image"],visionResponseModels:["fixture-vision"],plannerResponseModels:["fixture-plan"]},sale:{...packagePriceFixture.sale,settlement:"actual_capped",sharedCostPolicy:"include_once_if_any_success",minimumPolicy:"whole_order"}}:packagePriceFixture;
 let state:PackageOrder=createPackageOrder({id,userId:user,sessionId:session,referenceSignature:'server-binding',quote:buildCommercePackageQuote(cfg,{modules:['品牌首屏'],advanced:false,referenceCount:1})});
 let revision=1;let calls=0;let forbidden=false;let unknown=false;
 const rpc=async(_name:string,args:Record<string,unknown>)=>{
  const action=args.p_action,body=args.p_input as Record<string,unknown>;
  if(args.p_user_id!==user)return{data:null,error:{message:'package_not_found'}};
  if(action==='save') {
   if(body.expectedRevision!==revision)return{data:null,error:{message:'revision_conflict'}};
   state=structuredClone(body.state as PackageOrder);revision++;
  }
  return{data:{state:structuredClone(state),revision,settled:false,references:refs},error:null};
 };
 const service=createCommercePackageService({rpc},{
  authorize:async()=>{if(forbidden)throw Error('reference_forbidden');return refs.map(r=>({...r,dataUrl:'data:image/png;base64,AA=='}));},
  analyze:async()=>{calls++;if(unknown)throw Error('provider_outcome_unknown');return {data:analysis,usage:{input_tokens:100,output_tokens:20},model:'fixture-vision'};},
  plan:async()=>{calls++;return {data:{strategy:'留白',modules:[{name:'品牌首屏',copy:'白色杯身'}]},usage:{input_tokens:10,output_tokens:20},model:'fixture-plan'};},
 });
 return{service,get state(){return state;},get calls(){return calls;},deny:()=>{forbidden=true;},unknown:()=>{unknown=true;},
  seed:(s:PackageOrder)=>{state=s;},rpc};
}
describe('package stage orchestration',()=>{
 it('persists analysis, confirms edited facts, plans and recovers without repeated provider calls',async()=>{
  const t=setup();const a=await t.service.analyze(user,{orderId:id,references:refs});expect(a.analysis).toEqual(analysis);
  await t.service.analyze(user,{orderId:id,references:refs});expect(t.calls).toBe(1);
  await expect(t.service.plan(user,{orderId:id,references:refs})).rejects.toThrow('facts_confirmation_required');
  await t.service.confirm(user,{orderId:id,references:refs,name:'杯子',facts:'用户确认的白色杯身',styleSummary:''});
  const p=await t.service.plan(user,{orderId:id,references:refs});expect(p.planning?.modules[0]?.copy).toBe('白色杯身');
  await t.service.plan(user,{orderId:id,references:refs});expect(t.calls).toBe(2);
  expect(canonicalPackageJson(p)).not.toContain('visionInputPerMillionNano');expect(JSON.stringify(p)).not.toContain('fixture-cost');
 });
 it('checks private ownership before claiming or calling a provider',async()=>{
  const t=setup();t.deny();await expect(t.service.analyze(user,{orderId:id,references:refs})).rejects.toThrow('reference_forbidden');
  expect(t.calls).toBe(0);expect(t.state.stages[0]!.status).toBe('pending');
 });
 it('blocks changed reference roles or identities even if total count is unchanged',async()=>{
  const t=setup();await expect(t.service.analyze(user,{orderId:id,references:[{...refs[0],role:'style'}]})).rejects.toThrow('package_references_changed');expect(t.calls).toBe(0);
 });
 it('holds unknown provider outcomes and never calls the model again on retry',async()=>{
  const t=setup();t.unknown();await expect(t.service.analyze(user,{orderId:id,references:refs})).rejects.toThrow('provider_outcome_unknown');
  expect(t.state.status).toBe('needs_review');await expect(t.service.analyze(user,{orderId:id,references:refs})).rejects.toThrow('stage_result_pending');expect(t.calls).toBe(1);
 });
 it('allows only one optimistic claim when analysis requests race',async()=>{
  const t=setup();const out=await Promise.allSettled([t.service.analyze(user,{orderId:id,references:refs}),t.service.analyze(user,{orderId:id,references:refs})]);
  expect(out.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(t.calls).toBe(1);
 });
 it('does not expose another account order through the admin client',async()=>{
  const t=setup();await expect(t.service.get('55555555-5555-4555-8555-555555555555',id)).rejects.toThrow('package_not_found');expect(t.calls).toBe(0);
 });
});

it('stops the next paid stage when the previous usage cannot be verified',async()=>{
 const t=setup(true);await t.service.analyze(user,{orderId:id,references:refs});
 await t.service.confirm(user,{orderId:id,references:refs,name:'Cup',facts:'White body',styleSummary:''});
 await expect(t.service.plan(user,{orderId:id,references:refs})).rejects.toThrow('package_usage_unverified');expect(t.calls).toBe(1);
});

it('discloses the frozen configurable markup and minimum without leaking supplier tariffs',()=>{
 const q=buildCommercePackageQuote({...packagePriceFixture,sale:{...packagePriceFixture.sale,markupBps:12500,minimumMinor:75}},{modules:['品牌首屏'],advanced:false,referenceCount:1});
 const shown=publicPackageQuote(q);
 expect(shown.rule).toContain('125%');expect(shown.rule).toContain('0.75');expect(shown).not.toHaveProperty('costs');
});

it('reads a saved Edge receipt for an unknown stage without authorizing images or calling a model',async()=>{
 const t=setup();t.seed(markPackageUnknown(claimPackageStage(t.state,'analysis','old-claim'),'analysis','old-claim','lost_response'));
 let attempts=0,reads=0;
 const service=createCommercePackageService({rpc:t.rpc},{authorize:async()=>{attempts++;throw Error('must not download');},analyze:async()=>{attempts++;throw Error('must not call');},plan:async()=>{attempts++;throw Error('must not call');},recover:async()=>{reads++;return{data:analysis,usage:{inputTokens:1,outputTokens:1},model:'fixture-vision'};}});
 const value=await service.get(user,id);expect(value.analysis).toEqual(analysis);expect(attempts).toBe(0);expect(reads).toBe(1);
 await service.get(user,id);expect(reads).toBe(1);
});
it('does not mark an invalid recovered receipt as a valid analysis',async()=>{
 const t=setup();t.seed(markPackageUnknown(claimPackageStage(t.state,'analysis','old-claim'),'analysis','old-claim','lost_response'));
 const service=createCommercePackageService({rpc:t.rpc},{authorize:async()=>[],analyze:async()=>{throw Error();},plan:async()=>{throw Error();},recover:async()=>({data:{observations:'invalid'},usage:{},model:'fixture-vision'})});
 expect((await service.get(user,id)).stages[0]?.status).toBe('unknown');
});
