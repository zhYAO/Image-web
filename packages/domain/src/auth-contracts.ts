import { z } from 'zod';

export const accountSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().max(80).nullable(),
  status: z.enum(['active', 'deleting']),
});

export const emailAuthSchema = z.object({ email: z.email(), captchaToken: z.string().min(1).max(2048).optional() });
export const credentialsSchema = emailAuthSchema.extend({ password: z.string() });
export const registrationSchema = credentialsSchema.extend({
  legalVersion: z.string().min(1).max(80),
});
export const accountPatchSchema = z.object({ displayName: z.string().max(80).nullable() });
export const otpSchema = z.object({
  email: z.email(),
  token: z.string().regex(/^\d{6}$/),
  returnTo: z.string().optional(),
});

export type Account = z.infer<typeof accountSchema>;
