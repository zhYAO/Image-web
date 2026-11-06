import {z}from'zod';
import {commercePackageSelectionSchema}from'./commerce-package-pricing';
import {commerceAnalysisResultSchema}from'./commerce-analysis';
import {creativeStrategySchema}from'./creative-text-contracts';
import {minorSchema}from'./credits';
export const packageReferenceSchema=z.object({id:z.uuid(),role:z.enum(['product','style'])}).strict();
export const packageReferencesSchema=z.array(packageReferenceSchema).min(1).max(10).refine(v=>new Set(v.map(r=>r.id)).size===v.length&&v.some(r=>r.role==='product')&&v.filter(r=>r.role==='product').length<=6&&v.filter(r=>r.role==='style').length<=8,'invalid_package_references');
const common={orderId:z.uuid(),references:packageReferencesSchema};
export const packageRequestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('quote'),requestId:z.uuid(),sessionId:z.uuid(),imageModel:z.string().min(1).max(100),selection:commercePackageSelectionSchema,references:packageReferencesSchema}).strict(),
 z.object({action:z.literal('accept'),quoteId:z.uuid(),requestId:z.uuid(),totalMinor:minorSchema}).strict(),
 z.object({action:z.literal('analyze'),...common}).strict(),
 z.object({action:z.literal('plan'),...common}).strict(),
 z.object({action:z.literal('confirm'),...common,name:z.string().trim().min(1).max(160),facts:z.string().trim().min(1).max(4000),styleSummary:z.string().max(2000),platform:z.string().max(80).optional(),region:z.string().max(80).optional(),language:z.string().max(80).optional()}).strict(),
 z.object({action:z.literal('submit'),...common,taskId:z.uuid(),revision:z.number().int().min(1)}).strict(),
 z.object({action:z.literal('cancel'),orderId:z.uuid()}).strict(),
]);
export type PackageRequest=z.infer<typeof packageRequestSchema>;
export const packageQuoteViewSchema=z.object({totalMinor:minorSchema,minimumMinor:minorSchema,imageModel:z.string(),imageResolution:z.string().optional(),outputCount:z.number().int().min(1).max(32),settlementMode:z.enum(['fixed','actual_capped','fixed_images']),selection:commercePackageSelectionSchema,
 imagePrices:z.array(z.object({key:z.string(),amountMinor:minorSchema,module:z.string(),spec:z.enum(['standard','desktop','mobile'])})),rule:z.string()});
export const packageQuoteResponseSchema=packageQuoteViewSchema.extend({id:z.uuid(),expiresAt:z.string()});
export const packageReviewSchema=z.object({name:z.string(),facts:z.string(),styleSummary:z.string(),referenceSignature:z.string(),platform:z.string().optional(),region:z.string().optional(),language:z.string().optional()});
export const packageOrderViewSchema=z.object({id:z.uuid(),sessionId:z.uuid(),revision:z.number().int().min(1),status:z.enum(['active','needs_review','cancelled','completed','partial','failed']),settled:z.boolean(),quote:packageQuoteViewSchema,referenceSignature:z.string(),references:z.array(packageReferenceSchema),review:packageReviewSchema.optional(),taskId:z.uuid().optional(),analysis:commerceAnalysisResultSchema.optional(),planning:creativeStrategySchema.optional(),billingReviewReason:z.string().optional(),costReviewReason:z.string().optional(),
 stages:z.array(z.object({key:z.string(),kind:z.enum(['analysis','planning','image']),status:z.enum(['pending','processing','succeeded','failed','unknown','skipped']),amountMinor:minorSchema,generationId:z.uuid().optional()})),settlement:z.object({captureMinor:minorSchema,releaseMinor:minorSchema,pendingMinor:minorSchema,reviewReason:z.string().optional()})});
export type PackageOrderView=z.infer<typeof packageOrderViewSchema>;
export type PackageQuoteView=z.infer<typeof packageQuoteResponseSchema>;
