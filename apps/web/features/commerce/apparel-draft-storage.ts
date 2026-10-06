import { apparelPlanSchema, type ApparelBrief } from "@zimage/domain";
import { z } from "zod";
export const APPAREL_DRAFT_PREFIX = "zimage:apparel-draft:v1:";
export interface ApparelDraft {
  brief: ApparelBrief;
  crop: [number, number, number, number];
  roles: Record<string, string>;
  removed: string[];
  sessionRequest: string;
  remoteSession?: string;
  baseRevision?: number;
  pending?: {
    operation: "create" | "save";
    requestId: string;
    plan: z.infer<typeof apparelPlanSchema>;
    expectedRevision?: number;
  };
  submit?: { requestId: string; revision: number };
}
const record = z.object({
  savedAt: z.number(),
  draft: z.object({
    brief: z.object({
      name: z.string(),
      sku: z.string(),
      color: z.string(),
      composition: z.string(),
      care: z.string(),
      size: z.string(),
      measurements: z.object({
        length: z.string(),
        chest: z.string(),
        shoulder: z.string(),
        sleeve: z.string(),
      }),
      weightRecommendation: z.string(),
      design: z.string(),
      fabric: z.string(),
    }),
    crop: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    roles: z.record(z.string(), z.string()),
    removed: z.array(z.string()),
    sessionRequest: z.uuid(),
    remoteSession: z.string().optional(),
    baseRevision: z.number().int().positive().optional(),
    pending: z
      .object({
        operation: z.enum(["create", "save"]),
        requestId: z.uuid(),
        plan: apparelPlanSchema,
        expectedRevision: z.number().optional(),
      })
      .optional(),
    submit: z.object({ requestId: z.uuid(), revision: z.number() }).optional(),
  }),
});
export function loadApparelDraft(key: string): ApparelDraft | undefined {
  try {
    const parsed = record.safeParse(
      JSON.parse(sessionStorage.getItem(APPAREL_DRAFT_PREFIX + key) ?? "null"),
    );
    if (parsed.success && Date.now() - parsed.data.savedAt < 86400000)
      return parsed.data.draft;
  } catch {}
  return;
}
export function saveApparelDraft(key: string, draft: ApparelDraft) {
  sessionStorage.setItem(
    APPAREL_DRAFT_PREFIX + key,
    JSON.stringify({ savedAt: Date.now(), draft }),
  );
}
export function hasApparelDraft(key: string) {
  return Boolean(loadApparelDraft(key + ":new"));
}
