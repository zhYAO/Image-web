import { z } from 'zod';

export const skillTaskSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(),
  status: z.enum(['awaiting_input', 'queued', 'cancelled', 'replaced']),
  revision: z.number().int().positive(),
  skill: z.object({ id: z.string(), name: z.string(), version: z.string() }).optional(),
  message: z.string(), proposal: z.string(), question: z.string().optional(),
  referenceIds: z.array(z.uuid()).max(4),
  batchId: z.uuid().optional(),
  createdAt: z.string(),
});
export type SkillTask = z.infer<typeof skillTaskSchema>;
export const visibleImageSettingsSchema = z.object({
  aspectRatio: z.enum(['1:1', '3:4', '4:3', '9:16', '16:9']),
  resolution: z.enum(['1K', '2K']), count: z.number().int().min(1).max(4),
  provider: z.string().min(1), model: z.string().min(1),
});
export const taskActionSchema = z.strictObject({
  requestId: z.uuid(), taskId: z.uuid(), revision: z.number().int().positive(),
  action: z.enum(['cancel', 'replace']),
});
