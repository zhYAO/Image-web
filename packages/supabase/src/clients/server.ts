import { createServerClient as createSupabaseServerClient, type CookieMethodsServer } from '@supabase/ssr';

import type { Database } from '../database.types.js';
import type { WebServerEnv } from '@zima/config';

/**
 * Cookie contract that bridges the Next.js `cookies()` API with the Supabase
 * SSR helpers. The BFF must provide both the read and write surfaces so the
 * SDK can rotate refresh tokens on every response.
 */
export interface ServerCookieAdapter {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>): void;
}

/**
 * Convert the cookie adapter to the object shape expected by `@supabase/ssr`.
 * The SDK only reads `getAll` and `setAll`; the resulting function is the
 * minimum surface required by the official docs.
 */
const toCookieMethods = (adapter: ServerCookieAdapter): CookieMethodsServer => ({
  getAll: () => adapter.getAll(),
  setAll: (cookies) => {
    adapter.setAll(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        options: cookie.options,
      })),
    );
  },
});

/**
 * Server-side Supabase client bound to the current request cookies.
 *
 * The caller is responsible for passing the validated WebServerEnv so this
 * factory has no implicit dependency on `process.env`. The publishable key
 * keeps RLS authoritative for all user-scoped reads; the secret key is
 * only consulted by `createInternalClient` and never exposed here.
 */
export const createServerUserClient = (
  env: WebServerEnv,
  cookieAdapter: ServerCookieAdapter,
) => {
  const cookieMethods = toCookieMethods(cookieAdapter);

  return createSupabaseServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: cookieMethods,
    },
  );
};