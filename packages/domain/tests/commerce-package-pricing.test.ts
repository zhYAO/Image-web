import { describe, expect, it } from 'vitest';
import * as pricing from '../src/commerce-package-pricing';

import { packagePriceFixture } from './commerce-package-fixture';
const input={ modules:['品牌首屏','核心卖点'], advanced:false, referenceCount:1 };
const build=(cfg:unknown=packagePriceFixture,value:unknown=input)=>pricing.buildCommercePackageQuote(cfg,value);
describe('whole A+ package pricing',()=>{
 it('prices analysis, planning and all images once at cost plus 100%',()=>{
  const q=build(); // .0264 analysis + .0204 planning + 1.20 images = 1.2468; x2 = 2.4936 -> 250 Minor.
  expect(q.outputCount).toBe(2); expect(q.estimatedCostNano).toBe('1246800000'); expect(q.totalMinor).toBe(250);
  expect(q.stages.map(s=>s.key)).toEqual(['analysis','planning','image:0','image:1']);
  expect(q.stages.reduce((n,s)=>n+s.amountMinor,0)).toBe(250);
  expect(q.costVersion).toBe('fixture-cost-v1'); expect(q.saleVersion).toBe('fixture-sale-v1');
 });
 it('counts both desktop and mobile as separate outputs',()=>{
  const q=build(packagePriceFixture,{...input,advanced:true}); expect(q.outputCount).toBe(4);expect(q.totalMinor).toBe(490);
 });
 it('includes extra input references for every output',()=>{
  const q=build(packagePriceFixture,{...input,referenceCount:3}); expect(q.estimatedCostNano).toBe('1326800000');expect(q.totalMinor).toBe(266);
 });
 it('applies minimum once to the entire package, preserving exact allocation',()=>{
  const q=build({...packagePriceFixture,costs:{...packagePriceFixture.costs,imageOutputNano:'1',extraReferenceNano:'0',visionInputPerMillionNano:'0',visionOutputPerMillionNano:'0',plannerInputPerMillionNano:'0',plannerOutputPerMillionNano:'0'}});
  expect(q.totalMinor).toBe(50);expect(q.stages.map(s=>s.amountMinor)).toEqual([0,0,25,25]);
 });
 it('keeps high precision until total rounding and allows configurable markup',()=>{
  const q=build({...packagePriceFixture,sale:{...packagePriceFixture.sale,markupBps:0}}); expect(q.totalMinor).toBe(125);
  expect(build({...packagePriceFixture,costs:{...packagePriceFixture.costs,imageOutputNano:'600000001'}}).estimatedCostNano).toBe('1246800002');
 });
 it.each([
  {}, {...packagePriceFixture,costs:{...packagePriceFixture.costs,imageOutputNano:'-1'}},
  {...packagePriceFixture,sale:{...packagePriceFixture.sale,markupBps:10000.1}}, {...packagePriceFixture,sale:{...packagePriceFixture.sale,refund:undefined}},
  {...packagePriceFixture,costs:{...packagePriceFixture.costs,visionMaxOutputTokens:0}},
 ])('rejects unverified/incomplete or invalid config %#',cfg=>expect(()=>build(cfg)).toThrow());
 it.each([
  {...input,modules:[]},{...input,modules:['品牌首屏','品牌首屏']},{...input,modules:['虚构模块']},
  {...input,referenceCount:0},{...input,referenceCount:11},{...input,advanced:'yes'},
 ])('rejects invalid package selections %#',value=>expect(()=>build(packagePriceFixture,value)).toThrow());
 it('is immutable across later config and input mutation',()=>{
  const cfg=structuredClone(packagePriceFixture), i=structuredClone(input), q=build(cfg,i);
  cfg.sale.markupBps=0;i.modules.push('使用场景');
  expect(q.totalMinor).toBe(250);expect(q.selection.modules).toEqual(['品牌首屏','核心卖点']);expect(q.sale.markupBps).toBe(10000);
 });
});
