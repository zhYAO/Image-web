import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit } from '../../../../server/auth/http';

export const POST = authPost(z.object({ email: z.email() }), async ({ email }, request) => {
  await rateLimit(request, 'resend', email);
  await new AuthService(await createSupabaseServerClient()).resendSignup(email);
  return { accepted: true };
});
