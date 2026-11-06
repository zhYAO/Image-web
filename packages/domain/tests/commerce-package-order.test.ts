import { describe, expect, it } from 'vitest';
import { buildCommercePackageQuote } from '../src/commerce-package-pricing';
import { createPackageOrder, claimPackageStage, recordPackageResult, markPackageUnknown,
 confirmPackageFacts, cancelPackageOrder, recordPackageFailure, packageSettlement, attachPackageImages, refreshPackageImages } from '../src/commerce-package-order';
import { packagePriceFixture } from './commerce-package-fixture';
const quote=()=>buildCommercePackageQuote(packagePriceFixture,{modules:['品牌首屏','核心卖点'],advanced:false,referenceCount:1});
const fresh=()=>createPackageOrder({id:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333',quote:quote(),referenceSignature:'refs-v1'});
const analyzed=()=>recordPackageResult(claimPackageStage(fresh(),'analysis','a'),'analysis','a',{observations:[]});
const confirmed=()=>confirmPackageFacts(analyzed(),{name:'杯子',facts:'白色杯身',styleSummary:'',referenceSignature:'refs-v1'});
const planned=()=>recordPackageResult(claimPackageStage(confirmed(),'planning','p'),'planning','p',{strategy:'留白',modules:[]});
const submitted=()=>attachPackageImages(planned(),'task-id',['generation-1','generation-2']);
describe('whole package durable state transitions',()=>{
 it('requires explicit fact confirmation between analysis and planning',()=>{
  expect(()=>claimPackageStage(analyzed(),'planning','p')).toThrow('facts_confirmation_required');
  expect(claimPackageStage(confirmed(),'planning','p').stages[1]!.status).toBe('processing');
 });
 it('never reclaims a submitted or unknown model call',()=>{
  const running=claimPackageStage(fresh(),'analysis','a');
  expect(()=>claimPackageStage(running,'analysis','b')).toThrow('stage_already_claimed');
  const unknown=markPackageUnknown(running,'analysis','a','timeout');
  expect(()=>claimPackageStage(unknown,'analysis','b')).toThrow('stage_already_claimed');
  expect(unknown.status).toBe('needs_review');
  expect(recordPackageResult(unknown,'analysis','a',{observations:[]}).stages[0]!.status).toBe('succeeded');
 });
 it('preserves the original result on a duplicate result receipt',()=>{
  const done=analyzed();expect(recordPackageResult(done,'analysis','a',{observations:[]})).toEqual(done);
  expect(()=>recordPackageResult(done,'analysis','a',{changed:true})).toThrow('result_conflict');
 });
 it('rejects changed references and changed confirmation after it is frozen',()=>{
  expect(()=>confirmPackageFacts(analyzed(),{name:'杯',facts:'白',styleSummary:'',referenceSignature:'refs-v2'})).toThrow('reference_changed');
  expect(()=>confirmPackageFacts(confirmed(),{name:'杯',facts:'不同',styleSummary:'',referenceSignature:'refs-v1'})).toThrow('facts_already_confirmed');
 });
 it('refunds everything on cancellation before any image submission',()=>{
  const order=cancelPackageOrder(planned());expect(order.status).toBe('cancelled');
  expect(packageSettlement(order)).toEqual({captureMinor:0,releaseMinor:250,pendingMinor:0});
 });
 it('also permits a pre-image cancellation while analysis is running',()=>{
  expect(packageSettlement(cancelPackageOrder(claimPackageStage(fresh(),'analysis','a'))).releaseMinor).toBe(250);
 });
 it('does not treat an in-flight or unknown image as ungenerated',()=>{
  expect(()=>cancelPackageOrder(submitted())).toThrow('image_result_pending');
  const unknown=refreshPackageImages(submitted(),[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'unknown'}]);
  expect(unknown.status).toBe('needs_review');expect(packageSettlement(unknown)).toEqual({captureMinor:0,releaseMinor:0,pendingMinor:250});
 });
 it('charges only successful image allocations, with analysis/planning included',()=>{
  const partial=refreshPackageImages(submitted(),[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'failed'}]);
  expect(partial.status).toBe('partial');expect(packageSettlement(partial)).toEqual({captureMinor:125,releaseMinor:125,pendingMinor:0});
 });
 it('settles once the unknown image is reconciled without a second submission',()=>{
  const unknown=refreshPackageImages(submitted(),[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'unknown'}]);
  const done=refreshPackageImages(unknown,[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'succeeded'}]);
  expect(done.status).toBe('completed');expect(packageSettlement(done).captureMinor).toBe(250);
  expect(refreshPackageImages(done,[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'succeeded'}])).toEqual(done);
 });
 it('returns the whole reservation when every output definitely fails',()=>{
  const failed=refreshPackageImages(submitted(),[{id:'generation-1',outcome:'failed'},{id:'generation-2',outcome:'failed'}]);
  expect(packageSettlement(failed)).toEqual({captureMinor:0,releaseMinor:250,pendingMinor:0});
 });
 it('never attaches outputs before planning or accepts duplicate/missing generations',()=>{
  expect(()=>attachPackageImages(confirmed(),'task', ['a','b'])).toThrow('planning_required');
  expect(()=>attachPackageImages(planned(),'task', ['a','a'])).toThrow('invalid_package_images');
  expect(()=>refreshPackageImages(submitted(),[{id:'wrong',outcome:'succeeded'}])).toThrow('generation_mismatch');
 });
 it('preserves terminal evidence instead of downgrading a delivered image',()=>{
  const done=refreshPackageImages(submitted(),[{id:'generation-1',outcome:'succeeded'},{id:'generation-2',outcome:'succeeded'}]);
  expect(()=>refreshPackageImages(done,[{id:'generation-1',outcome:'unknown'},{id:'generation-2',outcome:'succeeded'}])).toThrow('terminal_result_conflict');
 });
 it('audits a definite pre-provider failure and refunds the unopened image stage',()=>{
  const failed=recordPackageFailure(claimPackageStage(fresh(),'analysis','a'),'analysis','a','not_submitted','invalid_private_image');
  expect(failed.stages[0]!.failure).toBe('invalid_private_image');expect(packageSettlement(failed).releaseMinor).toBe(250);
 });
 it('recovers equal JSONB results and confirmations irrespective of object key order',()=>{
  const a=recordPackageResult(claimPackageStage(fresh(),'analysis','a'),'analysis','a',{missing:[],observations:[]});
  expect(recordPackageResult(a,'analysis','a',{observations:[],missing:[]})).toEqual(a);
  const c=confirmed();expect(confirmPackageFacts(c,{facts:'白色杯身',name:'杯子',referenceSignature:'refs-v1',styleSummary:''})).toEqual(c);
 });
 it.each([NaN,Infinity,125.5,-1])('rejects invalid wallet allocations on creation and restoration %s',amount=>{
  const a=fresh();a.quote.stages[2]!.amountMinor=amount;a.stages[2]!.amountMinor=amount;
  expect(()=>createPackageOrder(a)).toThrow();expect(()=>packageSettlement(a)).toThrow();
 });
 it('rejects duplicate stage keys or inconsistent output counts in a restored snapshot',()=>{
  const a=fresh();a.stages[3]!.key='image:0';expect(()=>packageSettlement(a)).toThrow();
  const b=fresh();b.quote.outputCount=32;expect(()=>createPackageOrder(b)).toThrow();
 });

});
