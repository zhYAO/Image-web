import { useCallback, useEffect, useState } from 'react';
import { packageOrderViewSchema, type PackageOrderView } from '@zimage/domain';
import { defaultPackageClient, type PackageClient } from '@/gateways/commerce-package-gateway';
import { notifyCreditsChanged } from '@/gateways/mock-credit-ledger';
/** Reading an owned order reconciles receipts, never re-submits a provider request. */
export function CommercePackageStatus({orderId,client=defaultPackageClient}:{orderId:string;client?:PackageClient}) {
 const [order,setOrder]=useState<PackageOrderView>();const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{setBusy(true);try{const value=packageOrderViewSchema.parse(await client.read({orderId}));if(value.id!==orderId)throw Error('订单不匹配');setOrder(value);setMessage('');notifyCreditsChanged();}catch{setMessage('订单状态暂时无法核对，请保留原订单，勿重复生成。');}finally{setBusy(false);}},[client,orderId]);
 useEffect(()=>{const timer=setTimeout(()=>void refresh(),0);return()=>clearTimeout(timer);},[refresh]);
 const money=(n:number)=>(n/100).toFixed(2);
 return <section aria-label="整套订单结算"><p>整套订单 {orderId.slice(0,8)} · 分析和策划已包含；本任务按原订单恢复与结算。</p>
 {order&&<><p>{order.quote.rule}</p><p>授权上限 {money(order.quote.totalMinor)} 积分 · 已收 {money(order.settled?order.settlement.captureMinor:0)} · 已退 {money(order.settled?order.settlement.releaseMinor:0)} · 待核对/冻结 {money(order.settled?order.settlement.pendingMinor:order.quote.totalMinor)} 积分</p>
 {(order.billingReviewReason||order.settlement.reviewReason||order.status==='needs_review')&&<p role="status">结果或用量待核对，暂不自动扣款、退款或重新生成。</p>}
 {order.costReviewReason&&<p role="status">后台成本估值待核对；本单费用按已确认的固定图片单价处理。</p>}
 {order.review&&<details><summary>查看已确认的商品资料</summary><p>{order.review.name}</p><p>{order.review.facts}</p><p>{order.review.styleSummary}</p></details>}
 {order.planning&&<details><summary>查看已保存的策划</summary><p>{order.planning.strategy}</p>{order.planning.modules.map(m=><p key={m.name}>{m.name}：{m.copy}</p>)}</details>}
 {order.taskId&&<a href={`/sessions/${order.sessionId}?task=${order.taskId}&view=results`}>查看整套图片</a>}
 {!order.taskId&&!order.settled&&<button disabled={busy} onClick={async()=>{setBusy(true);try{setOrder(packageOrderViewSchema.parse(await client.post({action:'cancel',orderId})));notifyCreditsChanged();}catch{setMessage('取消结果待核对，请刷新原订单。');}finally{setBusy(false);}}}>出图前取消并全退</button>}</>}
 <button disabled={busy} onClick={()=>void refresh()}>刷新整套订单</button>{message&&<p role="status">{message}</p>}</section>;
}
