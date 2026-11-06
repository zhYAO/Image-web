import { calculatePackageActualSettlement, type PackageImageMetering } from './commerce-package-metering';
import { buildCommercePackageQuote, type CommercePackageQuote } from './commerce-package-pricing';
export type PackageStage = CommercePackageQuote['stages'][number] & {
  status:'pending'|'processing'|'succeeded'|'failed'|'unknown'|'skipped';
  claimId?:string; result?:unknown; metering?:PackageImageMetering; failure?:string; generationId?:string;
};
export interface PackageOrder {
  id:string;userId:string;sessionId:string;quote:CommercePackageQuote;referenceSignature:string;
  status:'active'|'needs_review'|'cancelled'|'completed'|'partial'|'failed';
  stages:PackageStage[]; taskId?:string;taskRevision?:number;
  review?:{name:string;facts:string;styleSummary:string;referenceSignature:string;platform?:string;region?:string;language?:string};
}
const final = (s:PackageOrder['status']) => ['cancelled','completed','partial','failed'].includes(s);
export function canonicalPackageJson(value:unknown):string {
  const normalize=(v:unknown):unknown=>{
    if(Array.isArray(v))return v.map(normalize);
    if(v!==null && typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,normalize(x)]));
    if(v===undefined || typeof v==='bigint' || (typeof v==='number' && !Number.isFinite(v)))throw Error('invalid_package_json');
    return v;
  };
  return JSON.stringify(normalize(value));
}
export function assertPackageSnapshot(o:PackageOrder) {
  const q=o.quote;
  const expected=buildCommercePackageQuote({costVersion:q.costVersion,saleVersion:q.saleVersion,costs:q.costs,sale:q.sale},q.selection);
  if(canonicalPackageJson(expected)!==canonicalPackageJson(q) || o.stages.length!==q.stages.length)throw Error('invalid_package_snapshot');
  for(let i=0;i<q.stages.length;i++) {
    const s=o.stages[i]!,e=q.stages[i]!;
    if(s.key!==e.key || s.kind!==e.kind || s.costNano!==e.costNano || s.amountMinor!==e.amountMinor || !['pending','processing','succeeded','failed','unknown','skipped'].includes(s.status))throw Error('invalid_package_snapshot');
  }
}
const copy = (o:PackageOrder) => {assertPackageSnapshot(o);return structuredClone(o);};
const stage = (o:PackageOrder,key:string) => {
  const s=o.stages.find(s=>s.key===key);if(!s) throw Error('stage_not_found');return s;
};
function active(o:PackageOrder) { if(final(o.status)) throw Error('package_order_closed'); }
function derive(o:PackageOrder):PackageOrder {
  if(o.status==='cancelled')return o;
  const images=o.stages.filter(s=>s.kind==='image');
  if(o.stages.some(s=>s.status==='unknown'))o.status='needs_review';
  else if(images.every(s=>['succeeded','failed','skipped'].includes(s.status))) {
    const n=images.filter(s=>s.status==='succeeded').length;
    o.status=n===images.length?'completed':n>0?'partial':'failed';
  } else o.status='active';
  if(o.quote.sale.settlement==='actual_capped' && ['completed','partial','failed'].includes(o.status) && calculatePackageActualSettlement(o).pendingMinor>0)o.status='needs_review';
  return o;
}
export function createPackageOrder(input:Omit<PackageOrder,'status'|'stages'>):PackageOrder {
  if(input.quote.sale.refund!=='successful_images')throw Error('package_policy_not_ready');
  const o:PackageOrder={...structuredClone(input),status:'active',stages:input.quote.stages.map(s=>({...s,status:'pending'}))};assertPackageSnapshot(o);return o;
}
export function claimPackageStage(order:PackageOrder,key:string,claimId:string) {
  active(order);const o=copy(order),s=stage(o,key);
  if(!claimId || s.status!=='pending')throw Error('stage_already_claimed');
  if(s.kind==='image')throw Error('use_funded_image_submission');
  if(s.kind==='planning' && (!o.review || stage(o,'analysis').status!=='succeeded'))throw Error('facts_confirmation_required');
  s.status='processing';s.claimId=claimId;return o;
}
export function recordPackageResult(order:PackageOrder,key:string,claimId:string,result:unknown) {
  const o=copy(order),s=stage(o,key);
  if(s.claimId!==claimId)throw Error('stage_claim_mismatch');
  if(s.status==='succeeded') {
    if(canonicalPackageJson(s.result)!==canonicalPackageJson(result))throw Error('result_conflict');return o;
  }
  active(o);if(!['processing','unknown'].includes(s.status) || s.kind==='image')throw Error('invalid_stage_completion');
  s.status='succeeded';s.result=structuredClone(result);delete s.failure;return derive(o);
}
export function markPackageUnknown(order:PackageOrder,key:string,claimId:string,reason:string) {
  active(order);const o=copy(order),s=stage(o,key);
  if(s.claimId!==claimId || !['processing','unknown'].includes(s.status))throw Error('stage_claim_mismatch');
  s.status='unknown';s.failure=reason;return derive(o);
}
export function confirmPackageFacts(order:PackageOrder,review:NonNullable<PackageOrder['review']>) {
  active(order);const o=copy(order);
  if(stage(o,'analysis').status!=='succeeded')throw Error('analysis_required');
  if(review.referenceSignature!==o.referenceSignature)throw Error('reference_changed');
  if(!review.name.trim() || !review.facts.trim() || review.name.length>160 || review.facts.length>4000 || review.styleSummary.length>2000)throw Error('invalid_package_facts');
  if(o.review && canonicalPackageJson(o.review)!==canonicalPackageJson(review))throw Error('facts_already_confirmed');
  o.review=structuredClone(review);return o;
}
export function attachPackageImages(order:PackageOrder,taskId:string,generationIds:string[]) {
  active(order);const o=copy(order),images=o.stages.filter(s=>s.kind==='image');
  if(stage(o,'planning').status!=='succeeded')throw Error('planning_required');
  if(!taskId || generationIds.length!==images.length || new Set(generationIds).size!==images.length || generationIds.some(id=>!id))throw Error('invalid_package_images');
  if(images.some(s=>s.status!=='pending'))throw Error('images_already_submitted');
  o.taskId=taskId;images.forEach((s,i)=>{s.status='processing';s.generationId=generationIds[i];});return o;
}
export function refreshPackageImages(order:PackageOrder,outcomes:Array<{id:string;outcome:'processing'|'succeeded'|'failed'|'unknown'}>) {
  const o=copy(order),images=o.stages.filter(s=>s.kind==='image');
  if(outcomes.length!==images.length || new Set(outcomes.map(i=>i.id)).size!==images.length || images.some(s=>!outcomes.some(i=>i.id===s.generationId)))throw Error('generation_mismatch');
  for(const s of images) {
    const next=outcomes.find(i=>i.id===s.generationId)!.outcome;
    if(['succeeded','failed'].includes(s.status) && next!==s.status)throw Error('terminal_result_conflict');
    if(s.status==='unknown' && next==='processing')continue;
    s.status=next;
  }
  return derive(o);
}
export function cancelPackageOrder(order:PackageOrder) {
  if(final(order.status))return copy(order);
  const o=copy(order);
  if(o.stages.some(s=>s.kind==='image' && ['processing','unknown'].includes(s.status)))throw Error('image_result_pending');
  for(const s of o.stages)if(!['succeeded','failed'].includes(s.status))s.status='skipped';
  o.status='cancelled';return o;
}
export function recordPackageFailure(order:PackageOrder,key:string,claimId:string,outcome:'not_submitted'|'rejected',reason:string) {
  active(order);const o=copy(order),s=stage(o,key);
  if(!['not_submitted','rejected'].includes(outcome) || s.kind==='image' || s.claimId!==claimId || !['processing','unknown'].includes(s.status))throw Error('definite_failure_evidence_required');
  s.status='failed';s.failure=reason;
  for(const other of o.stages)if(other.status==='pending')other.status='skipped';
  return derive(o);
}
export function packageSettlement(order:PackageOrder) {
  assertPackageSnapshot(order);
  if(order.quote.sale.settlement==='actual_capped')return calculatePackageActualSettlement(order);
  if(order.quote.sale.settlement==='fixed_images'){
    const images=order.stages.filter(s=>s.kind==='image'),total=order.quote.totalMinor;
    if(images.some(s=>!['succeeded','failed','skipped'].includes(s.status)))return{captureMinor:0,releaseMinor:0,pendingMinor:total};
    const successful=images.filter(s=>s.status==='succeeded');
    const capture=successful.length?Math.max(order.quote.sale.minimumMinor,successful.reduce((n,s)=>n+s.amountMinor,0)):0;
    if(!Number.isSafeInteger(capture)||capture>total)throw Error('invalid_package_settlement');
    return{captureMinor:capture,releaseMinor:total-capture,pendingMinor:0};
  }
  const total=order.quote.totalMinor;
  if(!final(order.status))return {captureMinor:0,releaseMinor:0,pendingMinor:total};
  const capture=order.stages.filter(s=>s.kind==='image' && s.status==='succeeded').reduce((n,s)=>n+s.amountMinor,0);
  if(!Number.isSafeInteger(capture) || capture<0 || capture>total)throw Error('invalid_package_settlement');
  return {captureMinor:capture,releaseMinor:total-capture,pendingMinor:0};
}
