import {z}from'zod';
import {packageOrderViewSchema,packageQuoteResponseSchema,packageReferencesSchema,type PackageRequest}from'@zimage/domain';
export const packageRecoverySchema=z.object({fingerprint:z.string().max(50000),quoteRequestId:z.uuid(),acceptRequestId:z.uuid(),references:packageReferencesSchema,quoteId:z.uuid().optional(),orderId:z.uuid().optional(),acceptAttempted:z.boolean().optional(),resumeFingerprint:z.string().max(50000).optional()}).strict();
export type PackageRecovery=z.infer<typeof packageRecoverySchema>;
async function json(response:Response){const body=await response.json();if(!response.ok)throw Error(body.message||'整套订单暂时无法读取，请保留原请求恢复。');return body;}
export const defaultPackageClient={
 list:async()=>z.object({orders:z.array(z.object({id:z.uuid()})).max(100)}).parse(await json(await fetch('/api/commerce-packages?active=1',{cache:'no-store'}))).orders.map(o=>o.id),
 available:async()=>{try{const r=await fetch('/api/commerce-packages',{cache:'no-store'});if(!r.ok)return false;return(await r.json()).enabled===true;}catch{return false;}},
 read:async(input:{orderId?:string;quoteId?:string})=>packageOrderViewSchema.parse(await json(await fetch('/api/commerce-packages?'+new URLSearchParams(input as Record<string,string>),{cache:'no-store'}))),
 post:async(input:PackageRequest)=>{const data=await json(await fetch('/api/commerce-packages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));return input.action==='quote'?packageQuoteResponseSchema.parse(data):packageOrderViewSchema.parse(data);},
};
export interface PackageClient{available():Promise<boolean>;read(input:{orderId?:string;quoteId?:string}):Promise<unknown>;post(input:PackageRequest):Promise<unknown>}
