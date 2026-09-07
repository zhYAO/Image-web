import { otpSchema } from '../../../../../../../packages/domain/src/auth-contracts';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../../lib/supabase/server';
import { authPost, rateLimit } from '../../../../../server/auth/http';
import { validatePassword } from '../../../../../server/auth/password-policy';

export const POST = authPost(otpSchema.extend({ password: z.string() }), async (input, request) => {
  await rateLimit(request, 'verify', input.email);
  const client = await createSupabaseServerClient();
  const password = await validatePassword(input.password, { fetcher: fetch, report: () => console.warn('[auth] hibp_unavailable') });
  if (!password.ok) return { reason: password.reason, updated: false };
  const verified = await client.auth.verifyOtp({ email: input.email, token: input.token, type: 'recovery' });
  if (verified.error) return { updated: false };
  const updated = await client.auth.updateUser({ password: input.password });
  if (updated.error) return { updated: false };
  await client.auth.signOut({ scope: 'global' });
  return { reauthenticationRequired: true, updated: true };
});
