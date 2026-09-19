import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost } from '../../../../server/auth/http';
import { validatePassword } from '../../../../server/auth/password-policy';
import { requireVerifiedUserId } from '../../../../server/route-context';

export const POST = authPost(z.object({ password: z.string(), recovery: z.boolean().default(false) }), async ({ password, recovery }) => {
  const client = await createSupabaseServerClient();
  await requireVerifiedUserId(client);
  const result = await validatePassword(password, { fetcher: fetch, report: () => console.warn('[auth] hibp_unavailable') });
  if (!result.ok) return { updated: false, reason: result.reason };
  const auth = new AuthService(client);
  await auth.updatePassword(password);
  await auth.signOut(recovery ? 'global' : 'others');
  return { reauthenticationRequired: recovery, updated: true };
});
