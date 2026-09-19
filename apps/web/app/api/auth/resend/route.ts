import { emailAuthSchema } from '../../../../../../packages/domain/src/auth-contracts';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit, requireCaptcha } from '../../../../server/auth/http';

export const POST = authPost(emailAuthSchema, async ({ email, captchaToken }, request) => {
  requireCaptcha(captchaToken);
  await rateLimit(request, 'resend', email);
  await new AuthService(await createSupabaseServerClient()).resendSignup(email, captchaToken);
  return { accepted: true };
});
