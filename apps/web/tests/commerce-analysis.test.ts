import { describe,it,expect,vi } from 'vitest';
import { analyzeCommerceImages } from '@/server/commerce-analysis/analysis-service';
const ref={id:'11111111-1111-4111-8111-111111111111',role:'product' as const};
const input={sessionId:'22222222-2222-4222-8222-222222222222',references:[ref],requestId:'33333333-3333-4333-8333-333333333333'};
const result={observations:[{sourceId:ref.id,text:'白色杯身',kind:'visible'}],styleSummary:'',missing:['容量'],conflicts:[]};
describe('commerce image analysis',()=>{
 it('rejects unauthorized references before calling the model',async()=>{const model=vi.fn();await expect(analyzeCommerceImages(input,{authorize:async()=>{throw Error('forbidden')},model})).rejects.toThrow('forbidden');expect(model).not.toHaveBeenCalled();});
 it('validates evidence IDs and never accepts invented sources',async()=>{await expect(analyzeCommerceImages(input,{authorize:async()=>[{...ref,dataUrl:'data:image/png;base64,AA=='}],model:async()=>JSON.stringify({...result,observations:[{...result.observations[0],sourceId:crypto.randomUUID()}]})})).rejects.toThrow();});
 it('returns observations without converting them into confirmed facts',async()=>{expect(await analyzeCommerceImages(input,{authorize:async()=>[{...ref,dataUrl:'data:image/png;base64,AA=='}],model:async()=>JSON.stringify(result)})).toEqual(result);});
});
