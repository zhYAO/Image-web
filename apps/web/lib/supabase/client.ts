'use client';

import { createBrowserClient } from '@supabase/ssr';

import { readSupabasePublicEnv } from './env';

export function createSupabaseBrowserClient() {
  const environment = readSupabasePublicEnv('http');
  if (!environment) throw new Error('Supabase browser configuration is unavailable.');
  return createBrowserClient(environment.url, environment.publishableKey);
}
