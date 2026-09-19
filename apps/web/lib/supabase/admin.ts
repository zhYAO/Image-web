import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.generated';
import { resolveSupabaseServiceEnv } from './service-env';

export function createSupabaseAdminClient() {
  const environment = resolveSupabaseServiceEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });

  return createClient<Database>(environment.url, environment.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
