import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit } from '../../../../server/auth/http';

export const POST = authPost(z.object({ email: z.email() }), async ({ email }, request) => {
  await rateLimit(request, 'recovery', email);
  await new AuthService(await createSupabaseServerClient()).requestPasswordReset(email, `${new URL(request.url).origin}/auth/reset`);
  return { accepted: true };
});
