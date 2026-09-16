import { creditConfirmationSchema } from "./credits";
import { z } from "zod";

export const creativeTextFieldSchema = z.enum([
  "name",
  "role",
  "facts",
  "sellingPoints",
  "title",
  "content",
  "exactText",
  "instruction",
]);
export type CreativeTextFieldName = z.infer<typeof creativeTextFieldSchema>;
export const creativeTextFieldLimits: Record<CreativeTextFieldName, number> = {
  name: 160,
  role: 80,
  facts: 4000,
  sellingPoints: 2000,
  title: 160,
  content: 4000,
  exactText: 1000,
  instruction: 2000,
};
export const creativeTextOptimizeRequestSchema = z
  .object({
    requestId: z.uuid().optional(),
    billing: creditConfirmationSchema.optional(),
    field: creativeTextFieldSchema,
    chatModel: z.enum(["doubao", "minimax"]).optional(),
    text: z.string().trim().min(1).max(6000),
    context: z.string().max(2000).optional(),
    maxLength: z.number().int().min(1).max(6000).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.text.length > creativeTextFieldLimits[input.field])
      ctx.addIssue({
        code: "custom",
        message: "Field text exceeds its limit",
        path: ["text"],
      });
  });
export type CreativeTextOptimizeRequest = z.infer<typeof creativeTextOptimizeRequestSchema>;
export const creativeTextOptimizeResponseSchema = z.object({ text: z.string().trim().min(1).max(6000), mock: z.boolean() }).strict();
export type CreativeTextOptimizeResponse = z.infer<typeof creativeTextOptimizeResponseSchema>;
