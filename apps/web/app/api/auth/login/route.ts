import { credentialsSchema } from '../../../../../../packages/domain/src/auth-contracts';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost, rateLimit } from '../../../../server/auth/http';

export const POST = authPost(credentialsSchema, async (input, request) => {
  await rateLimit(request, 'login', input.email);
  await new AuthService(await createSupabaseServerClient()).signIn(input);
  return { authenticated: true };
});
