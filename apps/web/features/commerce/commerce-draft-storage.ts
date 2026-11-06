import {packageRecoverySchema}from'@/gateways/commerce-package-gateway';
import { commerceBriefSchema, commercePlanSchema, commerceSettingsSchema, commerceSceneSchema, SELLING_LAYOUTS } from '@zimage/domain';
import { z } from 'zod';

const prefix = 'zimage:commerce-draft:v2:';
const maxAge = 24 * 60 * 60 * 1000;
export const commerceDraftSchema = z.object({
  scene: commerceSceneSchema,
  packageRecovery:packageRecoverySchema.optional(),
  editorStage: z.enum(['configure', 'review']).optional(),
  sellingLayouts: z.array(z.enum(SELLING_LAYOUTS)).max(20).optional(),
  referenceInstructions: z.record(z.string(), z.string().max(2000)).optional(),
  referenceSource: z.enum(['files', 'url']).optional(),
  sceneTab: z.enum(['templates', 'custom', 'reference']).optional(),
  brief: commerceBriefSchema,
  count: z.number().int().min(1).max(32),
  categoryCounts: z.object({ white: z.number().int().min(0).max(20), selling: z.number().int().min(0).max(20), scene: z.number().int().min(0).max(20), other: z.number().int().min(0).max(20) }).optional(),
  detailModules: z.array(z.string()).max(16).optional(),
  advancedAplus: z.boolean().optional(),
  touchedPresets: z.object({ region: z.boolean(), language: z.boolean(), aspectRatio: z.boolean() }).optional(),
  templateId: z.string(),
  instruction: z.string().max(2000),
  lastBuiltInstruction: z.string().max(2000).optional(),
  roles: z.record(z.string(), z.enum(['product', 'style'])),
  settings: commerceSettingsSchema.optional(),
  plan: commercePlanSchema.optional(),
  sessionId: z.string().optional(),
  // A create response may be lost. Keep the exact plan and request ID for replay.
  creation: z.object({ requestId: z.uuid(), plan: commercePlanSchema }).optional(),
});
export type CommerceDraftState = z.infer<typeof commerceDraftSchema>;

export function loadCommerceDraft(key: string): CommerceDraftState | undefined {
  try {
    const record = JSON.parse(sessionStorage.getItem(prefix + key) ?? 'null');
    if (!record || !Number.isFinite(record.savedAt) || Date.now() - record.savedAt > maxAge) return;
    const parsed = commerceDraftSchema.safeParse(record.draft);
    return parsed.success ? parsed.data : undefined;
  } catch { return; }
}
export function saveCommerceDraft(key: string, draft: CommerceDraftState) {
  // Before a remote mutation the caller must know its recovery identity is durable.
  sessionStorage.setItem(prefix + key, JSON.stringify({ savedAt: Date.now(), draft }));
}
export function clearCommerceDraft(key?: string) {
  try {
    if (key) sessionStorage.removeItem(prefix + key);
    else for (const name of Object.keys(sessionStorage)) if (name.startsWith(prefix) || name.startsWith('zimage:apparel-draft:v1:')) sessionStorage.removeItem(name);
  } catch { /* Logout must work when storage is unavailable. */ }
}
