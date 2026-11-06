import { z } from "zod";

export const minorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const creditConfirmationSchema = z
  .object({ version: z.string().min(1).max(100), totalMinor: minorSchema, rateVersion:z.string().min(1).max(100).optional() })
  .strict();
export type CreditConfirmation = z.infer<typeof creditConfirmationSchema>;
export const creditItemSchema = z
  .object({
    operation: z.enum(["image", "chat", "optimize"]),
    provider: z.string().min(1),
    model: z.string().min(1),
    resolution: z.string().default(""),
    count: z.number().int().min(1).max(8).default(1),
  })
  .strict();
export type CreditItem = z.infer<typeof creditItemSchema>;
export const creditPriceSchema = creditItemSchema
  .omit({ count: true })
  .extend({ unitMinor: minorSchema.min(1), label: z.string(), rateVersion:z.string().min(1).max(100).optional(),billingMode:z.literal('usage_capped').optional(), tokenTariff:z.object({inputPerMillionNano:z.string(),cachedInputPerMillionNano:z.string(),outputPerMillionNano:z.string(),cacheWritePerMillionNano:z.string().optional(),serviceTier:z.literal('default').optional(),cacheTtl:z.literal('30m').optional(),maxInputTokens:z.number(),maxOutputTokens:z.number()}).optional() });
export const creditCatalogSchema = z.object({
  version: z.string(),
  enabled: z.boolean(),
  prices: z.array(creditPriceSchema),
});
export type CreditCatalog = z.infer<typeof creditCatalogSchema>;
export const creditWalletSchema = z.object({
  availableMinor: minorSchema,
  frozenMinor: minorSchema,
  spentMinor: minorSchema,
});
export type CreditWallet = z.infer<typeof creditWalletSchema>;
export const creditQuoteSchema = creditConfirmationSchema.extend({
  items: z.array(
    creditItemSchema.extend({
      unitMinor: minorSchema,
      totalMinor: minorSchema,
    }),
  ),
});
export type CreditQuote = z.infer<typeof creditQuoteSchema>;
export const creditLedgerSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      kind: z.string(),
      amountMinor: minorSchema,
      operation: z.string().nullable(),
      model: z.string().nullable(),
      status: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type CreditLedger = z.infer<typeof creditLedgerSchema>;
export const TRIAL_CREDIT_CATALOG: CreditCatalog = {
  version: "2026-10-12.1",
  enabled: true,
  prices: [
    {
      operation: "image",
      provider: "seedream",
      model: "doubao-seedream-5.0-pro",
      resolution: "2K",
      unitMinor: 30,
      label: "Seedream 5.0 Pro",
    },
    {
      operation: "chat",
      provider: "doubao",
      model: "doubao",
      resolution: "",
      unitMinor: 2,
      label: "豆包",
    },
    {
      operation: "optimize",
      provider: "doubao",
      model: "doubao",
      resolution: "",
      unitMinor: 5,
      label: "豆包文字优化",
    },
  ],
};
export function formatCredits(minor: number) {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
export function quoteCredits(
  catalog: CreditCatalog,
  items: CreditItem[],
): CreditQuote {
  if (!catalog.enabled) throw new Error("积分服务尚未启用");
  const lines = items.map((raw) => {
    const item = creditItemSchema.parse(raw);
    const price = catalog.prices.find(
      (p) =>
        p.operation === item.operation &&
        p.provider === item.provider &&
        p.model === item.model &&
        p.resolution === item.resolution,
    );
    if (!price) throw new Error("所选模型暂无积分价格");
    return {
      ...item,
      unitMinor: price.unitMinor,
      totalMinor: price.unitMinor * item.count,
    };
  });
  return creditQuoteSchema.parse({
    version: catalog.version,
    ...(items.length===1&&items[0]?.operation==='chat'?{rateVersion:catalog.prices.find(p=>p.operation==='chat'&&p.model===items[0]?.model)?.rateVersion}:{}),
    totalMinor: lines.reduce((sum, i) => sum + i.totalMinor, 0),
    items: lines,
  });
}
export function imageCreditItem(input: {
  provider?: string;
  model?: string;
  resolution: string;
  count: number;
}): CreditItem {
  return {
    operation: "image",
    provider: input.provider ?? "seedream",
    model:
      input.model ??
      "doubao-seedream-5.0-pro",
    resolution: input.resolution,
    count: input.count,
  };
}
