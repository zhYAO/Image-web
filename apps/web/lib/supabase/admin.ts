import { createClient } from '@supabase/supabase-js';

import { resolveSupabaseServiceEnv } from './service-env';

export function createSupabaseAdminClient() {
  const environment = resolveSupabaseServiceEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  return createClient(environment.url, environment.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
