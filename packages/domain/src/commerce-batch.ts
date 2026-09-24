import { z } from 'zod';
import { commercePlanSchema } from './commerce';
import { creditConfirmationSchema } from './credits';

export const creativeBatchCreateSchema = z.object({
  requestId: z.uuid(),
  sessionId: z.uuid(),
  workflow: z.enum(['product-set', 'detail', 'clone']),
  globalParams: z.record(z.string(), z.unknown()),
  tasks: z.array(z.object({ plan: commercePlanSchema, billing: creditConfirmationSchema.optional(), overrides: z.record(z.string(), z.unknown()).default({}) })).min(1).max(20),
}).superRefine((input, context) => {
  for (const [index, task] of input.tasks.entries()) if (task.plan.scene !== input.workflow)
    context.addIssue({ code: 'custom', path: ['tasks', index, 'plan', 'scene'], message: '子任务流程与批量流程不一致。' });
});
export type CreativeBatchCreate = z.infer<typeof creativeBatchCreateSchema>;
export const creativeBatchItemSchema = z.object({
  id: z.uuid(), createRequestId: z.uuid(), submitRequestId: z.uuid(),
  plan: commercePlanSchema, billing: creditConfirmationSchema.optional(),
  overrides: z.record(z.string(), z.unknown()),
  taskId: z.uuid().optional(), status: z.enum(['pending', 'created', 'submitted', 'failed']),
  error: z.string().optional(),
});
export const creativeBatchSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(), requestId: z.uuid(), workflow: z.enum(['product-set','detail','clone']),
  globalParams: z.record(z.string(), z.unknown()), items: z.array(creativeBatchItemSchema),
  createdAt: z.string(), updatedAt: z.string(),
});
export type CreativeBatch = z.infer<typeof creativeBatchSchema>;
