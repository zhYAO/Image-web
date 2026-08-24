import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { readSupabasePublicEnv } from './env';

export async function createSupabaseServerClient() {
  const environment = readSupabasePublicEnv('http');
  if (!environment) throw new Error('Supabase server configuration is unavailable.');
  const cookieStore = await cookies();

  return createServerClient(environment.url, environment.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; proxy.ts performs refresh writes.
        }
      },
    },
  });
}
