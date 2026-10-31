import { creditConfirmationSchema } from "./credits";
import { DETAIL_MODULES } from './commerce-workflows';
import { z } from "zod";

const detailModuleNameSchema = z.string().trim().min(1).max(80).refine(value => DETAIL_MODULES.some(module => module === value), 'Unknown detail module');
const expectedModulesSchema = z.array(detailModuleNameSchema).min(1).max(DETAIL_MODULES.length)
  .refine(modules => new Set(modules).size === modules.length, 'Duplicate detail modules');

export const creativeStrategySchema = z.object({
  strategy: z.string().trim().min(1).max(2000),
  modules: z.array(z.object({ name: detailModuleNameSchema, copy: z.string().max(1000) }).strict()).min(1).max(DETAIL_MODULES.length),
}).strict().refine(value => new Set(value.modules.map(module => module.name)).size === value.modules.length, 'Duplicate detail modules');

export const creativeListingCopySchema = z.object({
  title: z.string().max(300),
  highlights: z.string().max(2000),
  description: z.string().max(4000),
  keywords: z.string().max(1000),
}).strict();

/** Legacy callers may omit the selection; supplied selections must match exactly. */
export function parseCreativeStrategy(value: unknown, expectedModules?: readonly string[]) {
  const result = creativeStrategySchema.parse(value);
  if (expectedModules) {
    const expected = new Set(expectedModulesSchema.parse(expectedModules));
    if (result.modules.length !== expected.size || result.modules.some(module => !expected.has(module.name)))
      throw new Error('optimized_response_module_mismatch');
  }
  return result;
}

export const creativeTextFieldSchema = z.enum([
  "description",
  "name",
  "role",
  "facts",
  "sellingPoints",
  "title",
  "content",
  "exactText",
  "instruction",
  "strategy",
  "listingCopy",
]);
export type CreativeTextFieldName = z.infer<typeof creativeTextFieldSchema>;
export const creativeTextFieldLimits: Record<CreativeTextFieldName, number> = {
  description: 4000,
  name: 160,
  role: 80,
  facts: 4000,
  sellingPoints: 2000,
  title: 160,
  content: 4000,
  exactText: 1000,
  instruction: 2000,
  strategy: 4000,
  listingCopy: 6000,
};
export const creativeTextOptimizeRequestSchema = z
  .object({
    requestId: z.uuid().optional(),
    billing: creditConfirmationSchema.optional(),
    field: creativeTextFieldSchema,
    chatModel: z.enum(["doubao", "minimax"]).optional(),
    text: z.string().trim().min(1).max(6000),
    context: z.string().max(2000).optional(),
    expectedModules: expectedModulesSchema.optional(),
    productContext: z.object({
      name: z.string().max(160).optional(),
      facts: z.string().max(4000).optional(),
      description: z.string().max(4000).optional(),
      sellingPoints: z.string().max(2000).optional(),
      platform: z.string().max(80).optional(),
      region: z.string().max(80).optional(),
      language: z.string().max(80).optional(),
      scene: z.string().max(80).optional(),
      designStyle: z.string().max(2000).optional(),
      imageRole: z.string().max(80).optional(),
    }).strict().optional(),
    maxLength: z.number().int().min(1).max(6000).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.expectedModules && input.field !== 'strategy')
      ctx.addIssue({ code: 'custom', message: 'Expected modules are only valid for strategy requests', path: ['expectedModules'] });
    if (input.text.length > creativeTextFieldLimits[input.field])
      ctx.addIssue({
        code: "custom",
        message: "Field text exceeds its limit",
        path: ["text"],
      });
  });
export type CreativeTextOptimizeRequest = z.infer<typeof creativeTextOptimizeRequestSchema>;
export function creativeTextChange(before: string, after: string): 'rewritten' | 'formatted' | 'unchanged' {
  if (before === after) return 'unchanged';
  const words = (text: string) => text.replace(/[\s\p{P}]/gu, '');
  return words(before) === words(after) ? 'formatted' : 'rewritten';
}
export const creativeTextOptimizeResponseSchema = z.object({ text: z.string().trim().min(1).max(6000), mock: z.boolean(), changeType: z.enum(['rewritten', 'formatted', 'unchanged']).optional() }).strict();
export type CreativeTextOptimizeResponse = z.infer<typeof creativeTextOptimizeResponseSchema>;
