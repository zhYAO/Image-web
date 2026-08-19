import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../database.types.js';
import type { WebServerEnv } from '@zima/config';

/**
 * Internal Supabase client used by the server-side BFF and Worker.
 *
 * Authenticated with the secret key so it can manage invitations, send
 * OTPs and exercise storage admin actions. This client MUST NEVER be
 * returned to or imported by browser code. Any value derived from it
 * (storage object keys, generated signed URLs, etc.) must be returned to
 * the caller as a short-lived token, not the raw client.
 */
export const createInternalClient = (env: WebServerEnv) =>
  createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );

/**
 * Worker-only Supabase client. The worker has no need for the publishable
 * key and must not expose the browser client. Only the secret key is
 * provided so that task lifecycle code can call admin APIs if necessary.
 */
export const createWorkerClient = (env: { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }) =>
  createSupabaseClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });