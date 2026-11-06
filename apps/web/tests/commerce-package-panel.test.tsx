import {expect,it}from'vitest';
import {render,screen,fireEvent,waitFor}from'@testing-library/react';
import {useState}from'react';
import {CommercePackagePanel}from'@/features/commerce/CommercePackagePanel';
const ref={id:'44444444-4444-4444-8444-444444444444',role:'product' as const};
const oid='11111111-1111-4111-8111-111111111111',qid='55555555-5555-4555-8555-555555555555';
const quote={id:qid,expiresAt:'2099-01-01',imageModel:'doubao-seedream-5.0-pro',totalMinor:250,minimumMinor:50,settlementMode:'actual_capped',outputCount:2,selection:{modules:['品牌首屏','核心卖点'],advanced:false,referenceCount:1},imagePrices:[],rule:'fixture'};
const analysis={observations:[{sourceId:ref.id,text:'白色杯身',kind:'visible'}],styleSummary:'',missing:['容量'],conflicts:[]};
const order=(analyzed=false)=>({id:oid,revision:analyzed?3:1,status:'active',settled:false,quote,sessionId:'33333333-3333-4333-8333-333333333333',referenceSignature:'server-frozen',references:[ref],stages:[{key:'analysis',kind:'analysis',status:analyzed?'succeeded':'pending',amountMinor:0},{key:'planning',kind:'planning',status:'pending',amountMinor:0},{key:'image:0',kind:'image',status:'pending',amountMinor:125},{key:'image:1',kind:'image',status:'pending',amountMinor:125}],settlement:{captureMinor:0,releaseMinor:0,pendingMinor:250},...(analyzed?{analysis}:{})});
function harness(saved?:Record<string,unknown>,fingerprint='original',lost=false){
 let persisted=saved;const posts:Array<Record<string,unknown>>=[];let confirmed='';
 const client={available:async()=>true,read:async()=>{if(lost)throw Error('read unavailable');return order(true);},post:async(body:Record<string,unknown>)=>{posts.push(body);if(body.action==='quote')return quote;if(body.action==='accept'){expect(persisted?.quoteId).toBe(qid);expect(persisted?.acceptRequestId).toBe(body.requestId);if(lost)throw Error('response lost');return order();}if(body.action==='analyze')return order(true);if(body.action==='confirm')return {...order(true),revision:4,review:{name:body.name,facts:body.facts,styleSummary:body.styleSummary,referenceSignature:'server-frozen'}};throw Error('Unexpected paid stage');}};
 function App(){const [recovery,setRecovery]=useState(saved),[value,setValue]=useState<unknown>();return <CommercePackagePanel fingerprint={fingerprint} recovery={recovery} order={value} client={client} initialName="Cup" prepare={async()=>({sessionId:'33333333-3333-4333-8333-333333333333',imageModel:quote.imageModel,references:[ref],selection:quote.selection})} onRecovery={(r:Record<string,unknown>)=>{persisted=r;setRecovery(r);}} onOrder={setValue} onConfirmed={(facts:string)=>{confirmed=facts;}} onResume={()=>setRecovery(r=>({...r,resumeFingerprint:fingerprint}))}/>;}
 return{App,posts,get persisted(){return persisted;},get confirmed(){return confirmed;}};
}
it('persists acceptance identity before reserving and never starts planning or images automatically',async()=>{
 const t=harness();render(<t.App/>);fireEvent.click(await screen.findByRole('button',{name:'查看整套最高费用'}));
 await screen.findByText(/2.50/);fireEvent.click(screen.getByRole('button',{name:'确认预算并分析'}));
 await screen.findByLabelText('检查并修改商品事实');expect(t.posts.map(p=>p.action)).toEqual(['quote','accept','analyze']);
 fireEvent.change(screen.getByLabelText('检查并修改商品事实'),{target:{value:'用户确认的杯身'}});fireEvent.click(screen.getByRole('button',{name:'确认商品资料，继续策划'}));
 await waitFor(()=>expect(t.confirmed).toBe('用户确认的杯身'));expect(t.posts.filter(p=>p.action==='confirm')[0]?.facts).toBe('用户确认的杯身');
});
it('recovers an accepted order after reload without repeating any provider call',async()=>{
 const saved={orderId:oid,quoteId:qid,quoteRequestId:crypto.randomUUID(),acceptRequestId:crypto.randomUUID(),fingerprint:'original',references:[ref]};
 const t=harness(saved);render(<t.App/>);await screen.findByLabelText('检查并修改商品事实');expect(t.posts).toHaveLength(0);
});
it('blocks new paid work when current image selection differs from the frozen order',async()=>{
 const saved={orderId:oid,quoteId:qid,quoteRequestId:crypto.randomUUID(),acceptRequestId:crypto.randomUUID(),fingerprint:'original',references:[ref]};
 const t=harness(saved,'changed');render(<t.App/>);const button=await screen.findByRole('button',{name:'确认商品资料，继续策划'});expect(button).toBeDisabled();expect(t.posts).toHaveLength(0);expect(screen.getByRole('button',{name:'恢复原订单的图片与设置'})).toBeInTheDocument();
});
it('retains the quote and request identity when the acceptance response is lost',async()=>{
 const t=harness(undefined,'original',true);render(<t.App/>);fireEvent.click(await screen.findByRole('button',{name:'查看整套最高费用'}));await screen.findByText(/2.50/);fireEvent.click(screen.getByRole('button',{name:'确认预算并分析'}));
 await screen.findByRole('alert');expect(t.persisted?.quoteId).toBe(qid);expect(t.persisted?.acceptRequestId).toBeTruthy();expect(t.posts.map(p=>p.action)).not.toContain('analyze');expect(screen.getByRole('button',{name:'查看整套最高费用'})).toBeDisabled();
});

it('also preserves a known order identity when its read fails before mount recovery completes',async()=>{
 const saved={orderId:oid,quoteId:qid,quoteRequestId:crypto.randomUUID(),acceptRequestId:crypto.randomUUID(),fingerprint:'original',references:[ref]};
 const t=harness(saved,'original',true);render(<t.App/>);
 await waitFor(()=>expect(screen.queryByText('整套服务暂未开放。已有订单仍可恢复或取消。')).toBeNull());
 expect(screen.getByRole('button',{name:'查看整套最高费用'})).toBeDisabled();expect(t.posts).toHaveLength(0);
});
