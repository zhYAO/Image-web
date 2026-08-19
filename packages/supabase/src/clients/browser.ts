import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr';

import type { Database } from '../database.types.js';
import type { PublicEnv } from '@zima/config';

/**
 * Browser-side Supabase client.
 *
 * Uses the publishable key only and is safe to expose to the browser bundle.
 * All access remains gated by RLS; secret keys, service-role keys, SMTP
 * credentials, supplier secrets and audit details never reach this client.
 *
 * The caller must pass the validated public env so this factory has no
 * implicit dependency on `process.env` (which is unavailable in edge
 * runtimes and not safe to read at module init in browser bundles).
 */
export const createBrowserClient = (env: PublicEnv) =>
  createSupabaseBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );