import { z } from 'zod';
import { DETAIL_MODULES } from './commerce-workflows';

// Supplier cost estimates keep nano-yuan precision; they are not paid-invoice evidence. Wallets retain their existing 0.01-credit unit.
const nano = z.string().regex(/^(0|[1-9][0-9]{0,18})$/);
const version = z.string().trim().min(1).max(100);
const tokens = z.number().int().min(1).max(256000);
export const commercePackageConfigSchema = z.object({
  costVersion: version,
  saleVersion: version,
  costs: z.object({
    imageResponseModels:z.array(version).min(1).max(10).optional(), visionResponseModels:z.array(version).min(1).max(10).optional(), plannerResponseModels:z.array(version).min(1).max(10).optional(),
    imageModel: version, imageResolution:z.enum(['1K','2K','4K']).optional(), imageOutputNano: nano, extraReferenceNano: nano,
    imageOutputLowNano: nano.optional(), imagePixelThreshold:z.number().int().min(1).max(100000000).optional(),
    visionModel: version, visionInputPerMillionNano: nano, visionOutputPerMillionNano: nano,
    plannerModel: version, plannerInputPerMillionNano: nano, plannerOutputPerMillionNano: nano,
    visionMaxInputTokens: tokens, visionMaxOutputTokens: tokens,
    plannerMaxInputTokens: tokens, plannerMaxOutputTokens: tokens,
    evidence: z.string().trim().min(10).max(2000),
  }).strict(),
  sale: z.object({
    markupBps: z.number().int().min(0).max(1000000),
    minimumMinor: z.number().int().min(50).max(100000000),
    quoteSeconds: z.number().int().min(60).max(3600),
    settlement: z.enum(['fixed','actual_capped','fixed_images']),
    priceEvidence:z.string().trim().min(10).max(2000).optional(),
    imagePrices:z.array(z.object({model:version,resolution:z.enum(['1K','2K','4K']),spec:z.enum(['standard','desktop','mobile']),estimatedUnitCostNano:nano.refine(v=>BigInt(v)>0n)}).strict()).min(1).max(96).optional(),
    sharedCostPolicy:z.enum(['include_once_if_any_success','prorated_to_selected']).optional(),
    minimumPolicy:z.enum(['whole_order','prorated_to_successful_outputs']).optional(),
    refund: z.enum(['pending', 'successful_images']),
  }).strict(),
}).strict().superRefine((v,c)=>{
  if(v.sale.settlement==='fixed_images'){
    if(!v.costs.imageResolution||!v.sale.priceEvidence||!v.sale.imagePrices||v.sale.minimumPolicy!=='whole_order')c.addIssue({code:'custom',message:'Published per-model/spec prices, approval evidence and whole-order minimum are required'});
    const prices=v.sale.imagePrices??[],keys=prices.map(p=>[p.model,p.resolution,p.spec].join(':'));
    if(new Set(keys).size!==keys.length)c.addIssue({code:'custom',message:'Duplicate model/spec price'});
  }
  if(v.sale.settlement==='actual_capped' && (!v.sale.sharedCostPolicy || !v.sale.minimumPolicy || !v.costs.imagePixelThreshold || !v.costs.imageResponseModels || !v.costs.visionResponseModels || !v.costs.plannerResponseModels))
    c.addIssue({code:'custom',message:'Explicit shared-cost, minimum and image tier policies are required'});
});
export type CommercePackageConfig = z.infer<typeof commercePackageConfigSchema>;
export const commercePackageSelectionSchema = z.object({
  modules: z.array(z.enum(DETAIL_MODULES)).min(1).max(16),
  advanced: z.boolean(),
  referenceCount: z.number().int().min(1).max(10),
}).strict().refine(v => new Set(v.modules).size === v.modules.length, 'duplicate_modules');
export type CommercePackageSelection = z.infer<typeof commercePackageSelectionSchema>;
export type CommercePackageQuote = ReturnType<typeof buildCommercePackageQuote>;
const ceilDiv = (n: bigint, d: bigint) => (n + d - 1n) / d;
const walletInteger = (n: bigint) => {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('package_amount_out_of_range');
  return Number(n);
};
export function tokenCostNano(input: number, output: number, inputPerMillion: string, outputPerMillion: string) {
  if (![input, output].every(v => Number.isSafeInteger(v) && v >= 0 && v <= 256000)) throw Error('invalid_provider_usage');
  const a = BigInt(nano.parse(inputPerMillion)), b = BigInt(nano.parse(outputPerMillion));
  return ceilDiv(BigInt(input) * a + BigInt(output) * b, 1000000n);
}

/** A fixed whole-package quote, with analysis/planning included in output prices. */
export function buildCommercePackageQuote(rawConfig: unknown, rawSelection: unknown) {
  const config = commercePackageConfigSchema.parse(rawConfig);
  const selection = commercePackageSelectionSchema.parse(rawSelection);
  const count = selection.modules.length * (selection.advanced ? 2 : 1);
  const costs = config.costs;
  const analysis = tokenCostNano(costs.visionMaxInputTokens, costs.visionMaxOutputTokens,
    costs.visionInputPerMillionNano, costs.visionOutputPerMillionNano);
  const planning = tokenCostNano(costs.plannerMaxInputTokens, costs.plannerMaxOutputTokens,
    costs.plannerInputPerMillionNano, costs.plannerOutputPerMillionNano);
  const high=BigInt(costs.imageOutputNano),low=BigInt(costs.imageOutputLowNano??'0');
  const image = (high>low?high:low) + BigInt(selection.referenceCount - 1) * BigInt(costs.extraReferenceNano);
  const totalCost = analysis + planning + image * BigInt(count);
  const calculated = ceilDiv(totalCost * BigInt(10000 + config.sale.markupBps), 10000n * 10000000n);
  const fixedUnits=config.sale.settlement==='fixed_images'?Array.from({length:count},(_,i)=>{
    const spec=selection.advanced?(i<selection.modules.length?'desktop':'mobile'):'standard';
    const price=config.sale.imagePrices?.find(p=>p.model===costs.imageModel&&p.resolution===costs.imageResolution&&p.spec===spec);
    if(!price)throw Error('package_image_price_unpublished');
    return walletInteger(ceilDiv(BigInt(price.estimatedUnitCostNano)*BigInt(10000+config.sale.markupBps),10000n*10000000n));
  }):undefined;
  const totalMinor = Math.max(config.sale.minimumMinor, fixedUnits?walletInteger(fixedUnits.reduce((n,p)=>n+BigInt(p),0n)):walletInteger(calculated));
  // Keep the shared costs included; they never create separate user charges.
  // A deterministic allocation supports audit, without activating a refund policy.
  const base = Math.floor(totalMinor / count), remainder = totalMinor % count;
  const stages = [
    { key: 'analysis', kind: 'analysis' as const, costNano: analysis.toString(), amountMinor: 0 },
    { key: 'planning', kind: 'planning' as const, costNano: planning.toString(), amountMinor: 0 },
    ...Array.from({ length: count }, (_, i) => ({ key: `image:${i}`, kind: 'image' as const,
      costNano: image.toString(), amountMinor: fixedUnits?.[i]??(base + (i < remainder ? 1 : 0)) })),
  ];
  return { costVersion: config.costVersion, saleVersion: config.saleVersion,
    costs, sale: config.sale, selection, outputCount: count,
    estimatedCostNano: totalCost.toString(), totalMinor, stages };
}
