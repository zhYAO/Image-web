import { commerceBriefSchema, commerceSettingsSchema } from "@zimage/domain";
import { z } from "zod";

const rowSchema = z.object({
  id: z.uuid(),
  name: z.string().max(160),
  description: z.string().max(4000),
  sellingPoints: z.string().max(2000),
  instruction: z.string().max(2000),
  platform: commerceBriefSchema.shape.platform.optional(),
  region: commerceBriefSchema.shape.region,
  language: commerceBriefSchema.shape.language,
  generation: commerceSettingsSchema.optional(),
  count: z.number().int().min(1).max(20).optional(),
  advanced: z.boolean().optional(),
  cloneMode: commerceBriefSchema.shape.cloneMode,
});
const draftSchema = z.object({
  workflow: z.enum(["product-set", "detail", "clone"]),
  platform: commerceBriefSchema.shape.platform,
  region: commerceBriefSchema.shape.region.unwrap(),
  language: commerceBriefSchema.shape.language.unwrap(),
  generation: commerceSettingsSchema,
  count: z.number().int().min(1).max(20),
  advanced: z.boolean(),
  rows: z.array(rowSchema).min(1).max(20),
  touched: z
    .object({
      region: z.boolean(),
      language: z.boolean(),
      aspectRatio: z.boolean(),
    })
    .optional(),
});
export function batchDraftKey(owner: string, draft: string) {
  return `zimage:commerce-batch-draft:v2:${encodeURIComponent(owner)}:${encodeURIComponent(draft)}`;
}
export function batchAttachmentKey(
  key: string,
  row: string,
  role: "products" | "references",
) {
  return `${key}:${row}:${role}`;
}
export function loadBatchDraft(key: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !saved ||
      !Number.isFinite(saved.savedAt) ||
      Date.now() - saved.savedAt > 86400000
    )
      return;
    const parsed = draftSchema.safeParse(saved.draft);
    if (parsed.success) return parsed.data;
  } catch {
    /* Unowned v1 localStorage data is intentionally not imported. */
  }
}
export function saveBatchDraft(key: string, draft: unknown) {
  sessionStorage.setItem(
    key,
    JSON.stringify({ savedAt: Date.now(), draft: draftSchema.parse(draft) }),
  );
}
