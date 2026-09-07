import { emailAuthSchema } from '../../../../../../packages/domain/src/auth-contracts';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit, requireCaptcha } from '../../../../server/auth/http';

export const POST = authPost(emailAuthSchema, async ({ email, captchaToken }, request) => {
  requireCaptcha(captchaToken);
  await rateLimit(request, 'recovery', email);
  await new AuthService(await createSupabaseServerClient()).requestPasswordReset(email, `${new URL(request.url).origin}/auth/reset`, captchaToken);
  return { accepted: true };
});
