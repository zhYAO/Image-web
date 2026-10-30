import { createServerClient, serializeCookieHeader } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { ApiRouteError } from '@/server/api-error';
import { readAuthCookieUpdates, recordAuthResponseHeaders } from '@/server/route-context';
import type { Database } from './database.generated';
import { readSupabasePublicEnv } from './env';

export async function createSupabaseServerClient() {
  let environment;
  try { environment = readSupabasePublicEnv('http'); } catch { /* Fail closed as unavailable, never signed out. */ }
  if (!environment) throw new ApiRouteError({ code: 'network', message: '身份验证服务暂时不可用，请稍后重试。', retryable: true, status: 503 });
  const cookieStore = await cookies();

  return createServerClient<Database>(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        const values = new Map(cookieStore.getAll().map(({ name, value }) => [name, value]));
        for (const [name, value] of readAuthCookieUpdates() ?? []) values.set(name, value);
        return [...values].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers) {
        if (recordAuthResponseHeaders(cookiesToSet.map(({ name, value, options }) => ({
          name, value, header: serializeCookieHeader(name, value, options),
        })), headers)) return;
        // Outside executeRoute, preserve Next Server Actions/legacy pages.
        // Inside it, avoid Next's name-only Cookie map losing scoped deletions.
        try {
          cookiesToSet.forEach(({ name, options, value }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts performs refresh writes.
        }
      },
    },
  });
}
