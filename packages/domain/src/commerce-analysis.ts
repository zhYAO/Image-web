import { z } from 'zod';
export const commerceAnalysisRequestSchema = z.object({
 requestId:z.uuid(), sessionId:z.uuid(), references:z.array(z.object({id:z.uuid(),role:z.enum(['product','style'])}).strict()).min(1).max(10),
}).strict().refine(v=>v.references.some(r=>r.role==='product') && new Set(v.references.map(r=>r.id)).size===v.references.length,'Unique references and a product image are required');
export const commerceAnalysisResultSchema = z.object({
 observations:z.array(z.object({sourceId:z.uuid(),text:z.string().trim().min(1).max(500),kind:z.enum(['visible','printed','inferred'])}).strict()).max(40),
 styleSummary:z.string().max(2000), missing:z.array(z.string().max(200)).max(20),conflicts:z.array(z.string().max(500)).max(20),
}).strict();
export type CommerceAnalysisResult = z.infer<typeof commerceAnalysisResultSchema>;
export const analysisInputSignature = (references:Array<{id?:string;name:string;size:number}>) => JSON.stringify(references.map(r=>[r.id,r.name,r.size]));

/** Check new work only; an already frozen request must retain its original body. */
export function assertAnalysisReviewCurrent(review:{referenceSignature:string;facts:string}|undefined,signature:string,facts:string) {
 if(review && (review.referenceSignature!==signature || review.facts!==facts)) throw Error('图片或资料已变化，请重新检查并确认分析资料。');
}
