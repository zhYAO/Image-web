import { otpSchema } from '../../../../../../packages/domain/src/auth-contracts';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit } from '../../../../server/auth/http';

export const POST = authPost(otpSchema, async (input, request) => {
  await rateLimit(request, 'verify', input.email);
  return new AuthService(await createSupabaseServerClient()).verifyEmailOtp(input);
});
