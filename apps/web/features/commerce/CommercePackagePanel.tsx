import {useEffect,useRef,useState}from'react';
import {formatCredits,packageOrderViewSchema,packageQuoteResponseSchema,packageRequestSchema,type PackageOrderView,type PackageQuoteView}from'@zimage/domain';
import {defaultPackageClient,packageRecoverySchema,type PackageRecovery,type PackageClient}from'@/gateways/commerce-package-gateway';
import {notifyCreditsChanged}from'@/gateways/mock-credit-ledger';
import {CommerceAnalysisPanel}from'./CommerceAnalysisPanel';
interface Props{
 fingerprint:string;reviewMatches?:boolean;recovery?:unknown;order?:unknown;initialName?:string;client?:PackageClient;
 context?:{platform?:string;region?:string;language?:string};
 prepare:()=>Promise<unknown>;onRecovery:(recovery:PackageRecovery)=>void;
 onOrder:(order:PackageOrderView|undefined)=>void;onConfirmed:(facts:string,style:string,name:string,order:PackageOrderView)=>void;
 onResume:(order:PackageOrderView)=>void;
}
export function CommercePackagePanel(props:Props){
 const client=props.client??defaultPackageClient,callbacks=useRef(props);useEffect(()=>{callbacks.current=props;},[props]);
 const parsed=packageRecoverySchema.safeParse(props.recovery),recovery=parsed.success?parsed.data:undefined;
 const value=packageOrderViewSchema.safeParse(props.order),order=value.success?value.data:undefined;
 const [quote,setQuote]=useState<PackageQuoteView>(),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState(props.initialName??'');
 const invalidRecovery=props.recovery!=null&&!parsed.success;
 const matches=props.reviewMatches!==false&&Boolean(recovery&&(recovery.resumeFingerprint??recovery.fingerprint)===props.fingerprint);
 const write=(r:PackageRecovery)=>callbacks.current.onRecovery(r);
 const commit=(o:PackageOrderView,r:PackageRecovery)=>{write({...r,orderId:o.id});callbacks.current.onOrder(o);notifyCreditsChanged();if(o.review)setName(o.review.name);};
 useEffect(()=>{
  let live=true;void client.available().then(enabled=>{if(live)setAvailable(enabled);});
  const r=recovery;
  if(r?.orderId||(r?.quoteId&&r.acceptAttempted))void client.read(r.orderId?{orderId:r.orderId}:{quoteId:r.quoteId}).then(raw=>{
   if(!live)return;const o=packageOrderViewSchema.parse(raw);write({...r,orderId:o.id});callbacks.current.onOrder(o);if(o.review)setName(o.review.name);notifyCreditsChanged();
  }).catch(()=>{/* A lost accept response is recovered by the explicit read button. */});
  return()=>{live=false;};
 // Request identities are persisted before these dependencies change.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[client,recovery?.orderId,recovery?.quoteId,recovery?.acceptAttempted]);
 const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'订单操作失败，原记录已保留。');}finally{setBusy(false);}};
 const analyzed=async(o:PackageOrderView,r:PackageRecovery)=>{
  if((r.resumeFingerprint??r.fingerprint)!==callbacks.current.fingerprint)throw Error('图片或设置已变化，请恢复原订单或取消后重新报价。');
  const result=packageOrderViewSchema.parse(await client.post({action:'analyze',orderId:o.id,references:o.references}));commit(result,r);
  if(!result.analysis)throw Error('分析尚未完成，请恢复原订单，不要重复购买。');return result.analysis;
 };
 const budget=order?.quote??quote;
 return <section aria-label="整套A+订单">
  <h3>整套 A+：分析、策划到出图</h3>
  <p>先确认整套报价，再分析图片并检查商品资料。按模型、规格和成功图片张数收费，分析和策划已包含；最低费用和固定单价以本单报价为准。供应商用量用于后台成本估算。</p>
  {!available&&<p>整套服务暂未开放。已有订单仍可恢复或取消。</p>}
  {invalidRecovery&&<p role="alert">订单缓存无法读取，请先核对账户记录，暂不创建新订单。</p>}
  {(!order||order.settled)&&<button type="button" disabled={busy||!available||invalidRecovery||Boolean(!order&&(recovery?.acceptAttempted||recovery?.orderId))} onClick={()=>void act(async()=>{
   const prepared=await callbacks.current.prepare()as Record<string,unknown>;
   const r:PackageRecovery={fingerprint:callbacks.current.fingerprint,quoteRequestId:crypto.randomUUID(),acceptRequestId:crypto.randomUUID(),references:prepared.references as PackageRecovery['references']};
   write(r);callbacks.current.onOrder(undefined);
   const request=packageRequestSchema.parse({...prepared,action:'quote',requestId:r.quoteRequestId});
   const q=packageQuoteResponseSchema.parse(await client.post(request));setQuote(q);write({...r,quoteId:q.id});
  })}>查看整套最高费用</button>}
  {budget&&<p>共 {budget.outputCount} 张 · 最高冻结 {formatCredits(budget.totalMinor)} 积分 · 有成功图片最低 {formatCredits(budget.minimumMinor)} 积分</p>}
  {budget&&<p>{budget.rule}</p>}
  {budget?.settlementMode==='fixed_images'&&<ul aria-label="本单固定图片单价">{budget.imagePrices.map(p=><li key={p.key}>{budget.imageModel} · {budget.imageResolution} · {p.module} · {p.spec}：{formatCredits(p.amountMinor)} 积分/张</li>)}</ul>}
  {order?.costReviewReason&&<p role="status">后台供应商用量或成本估值待核对，本单售价仍按已确认图片单价处理。</p>}
  {quote&&!order&&<button type="button" disabled={busy||!available||!matches||!recovery} onClick={()=>void act(async()=>{
   if(!recovery)throw Error('请先查看预算。');
   const r={...recovery,acceptAttempted:true};write(r);
   const o=packageOrderViewSchema.parse(await client.post({action:'accept',quoteId:quote.id,requestId:r.acceptRequestId,totalMinor:quote.totalMinor}));commit(o,r);
   await analyzed(o,{...r,orderId:o.id});
  })}>确认预算并分析</button>}
  {order&&!matches&&!order.settled&&<><p role="alert">当前图片或设置与原订单不同，新的付费操作已阻止。</p><button type="button" disabled={busy} onClick={()=>props.onResume(order)}>恢复原订单的图片与设置</button></>}
  {recovery&&(recovery.orderId||recovery.quoteId)&&<button type="button" disabled={busy} onClick={()=>void act(async()=>{
   const o=packageOrderViewSchema.parse(await client.read(recovery.orderId?{orderId:recovery.orderId}:{quoteId:recovery.quoteId}));commit(o,recovery);
  })}>恢复订单状态</button>}
  {order&&!order.settled&&!order.stages.some(s=>s.kind==='image'&&s.generationId)&&<button type="button" disabled={busy} onClick={()=>void act(async()=>{
   if(!recovery)return;commit(packageOrderViewSchema.parse(await client.post({action:'cancel',orderId:order.id})),recovery);
  })}>取消未出图订单并退回预算</button>}
  {order?.billingReviewReason&&<p role="alert">供应商用量待核对，暂不继续付费操作。出图前仍可取消并全额退回。</p>}
  {order&&<p>已扣 {formatCredits(order.settled?order.settlement.captureMinor:0)} · 已退 {formatCredits(order.settled?order.settlement.releaseMinor:0)} · 待核对或仍冻结 {formatCredits(order.settled?order.settlement.pendingMinor:order.quote.totalMinor)} 积分</p>}
  <label>确认商品名称<input aria-label="确认商品名称" value={order?.review?.name??name} maxLength={160} disabled={busy||Boolean(order?.review)} onChange={e=>setName(e.target.value)}/></label>
  <CommerceAnalysisPanel key={(order?.id??'new')+(order?.analysis?':analyzed':':pending')}
   signature={props.fingerprint} initialSignature={recovery?.resumeFingerprint??recovery?.fingerprint}
   initialResult={order?.analysis} initialFacts={order?.review?.facts} initialStyle={order?.review?.styleSummary}
   confirmed={Boolean(order?.review)} disabled={busy||!available||!order||!matches||Boolean(order?.billingReviewReason)}
   notice="分析和策划包含在整套预算中，不单独扣费。先核实商品资料，再生成策划。"
   onAnalyze={async()=>{if(!order||!recovery)throw Error('请先确认整套最高预算。');return analyzed(order,recovery);}}
   onConfirm={async(facts,style)=>{
    if(!order||!recovery||!matches)throw Error('请先恢复原订单。');
    if(!name.trim())throw Error('请填写确认商品名称。');
    const o=packageOrderViewSchema.parse(await client.post({action:'confirm',orderId:order.id,references:order.references,name:name.trim(),facts,styleSummary:style,...props.context}));commit(o,recovery);props.onConfirmed(facts,style,name.trim(),o);
   }}/>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
