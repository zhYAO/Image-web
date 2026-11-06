import{useCallback,useEffect,useState}from'react';
import{defaultPackageClient,type PackageClient}from'@/gateways/commerce-package-gateway';
import{CommercePackageStatus}from'./CommercePackageStatus';
type RecoveryClient=PackageClient&{list:()=>Promise<string[]>};
/** Account-scoped discovery survives browser storage loss. No provider work starts here. */
export function CommercePackageRecoveryList({client=defaultPackageClient}:{client?:RecoveryClient}){
 const[ids,setIds]=useState<string[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);try{setIds(await client.list());setMessage('');}catch{setMessage('未结算订单暂时无法读取，请刷新核对，勿重新购买。');}finally{setBusy(false);}},[client]);
 useEffect(()=>{let live=true;void client.list().then(v=>{if(live)setIds(v);}).catch(()=>{if(live)setMessage('未结算订单暂时无法读取，请刷新核对，勿重新购买。');});return()=>{live=false;};},[client]);
 return<section aria-label="找回未结算整套订单"><h2>未结算整套订单</h2><p>浏览器草稿丢失后仍可在这里核对原订单；出图前可取消并全退。每次最多显示100条，处理后刷新继续查看。</p>
 <button disabled={busy} onClick={()=>void load()}>刷新未结算订单</button>{message&&<p role="status">{message}</p>}
 {ids.map(id=><CommercePackageStatus key={id} orderId={id} client={client}/>)}{!ids.length&&!message&&<p>暂无未结算整套订单。</p>}</section>;
}
