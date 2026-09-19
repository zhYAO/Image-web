import { z } from 'zod';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { AuthService } from '../../../../server/auth/auth-service';
import { authPost } from '../../../../server/auth/http';

export const POST = authPost(z.object({}), async () => {
  await new AuthService(await createSupabaseServerClient()).signOut('local');
  return { signedOut: true };
});
