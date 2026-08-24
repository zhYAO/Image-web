'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from './database.generated';
import { readSupabasePublicEnv } from './env';

export function createSupabaseBrowserClient() {
  const environment = readSupabasePublicEnv('http');
  if (!environment) throw new Error('Supabase browser configuration is unavailable.');
  return createBrowserClient<Database>(environment.url, environment.publishableKey);
}
