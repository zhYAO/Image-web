import { describe, expect, it } from 'vitest';

import { resolveSupabasePublicEnv } from '@/lib/supabase/env';
import { shouldBootstrapAnonymousUser } from '@/lib/supabase/proxy';
import { resolveSupabaseServiceEnv } from '@/lib/supabase/service-env';

describe('Supabase Web boundary', () => {
  it('keeps mock builds independent from Supabase environment variables', () => {
    expect(resolveSupabasePublicEnv({}, 'mock')).toBeNull();
  });

  it('fails closed when HTTP mode is missing its public Supabase configuration', () => {
    expect(() => resolveSupabasePublicEnv({}, 'http')).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('accepts a publishable browser key and rejects a service-role JWT', () => {
    expect(resolveSupabasePublicEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_test_key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    }, 'http')).toEqual({
      publishableKey: 'sb_publishable_local_test_key',
      url: 'https://project.supabase.co',
    });

    const serviceRoleKey = [
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
      Buffer.from('{"role":"service_role"}').toString('base64url'),
      'signature',
    ].join('.');
    expect(() => resolveSupabasePublicEnv({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRoleKey,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    }, 'http')).toThrow(/service_role/);
  });

  it('creates anonymous identities only for first-party document navigations', () => {
    expect(shouldBootstrapAnonymousUser({ accept: 'text/html', method: 'GET', pathname: '/' })).toBe(true);
    expect(shouldBootstrapAnonymousUser({ accept: 'application/json', method: 'GET', pathname: '/api/sessions' })).toBe(false);
    expect(shouldBootstrapAnonymousUser({ accept: 'text/html', method: 'POST', pathname: '/' })).toBe(false);
    expect(shouldBootstrapAnonymousUser({ accept: 'text/html', method: 'GET', pathname: '/api/openapi.json' })).toBe(false);
  });

  it('accepts elevated credentials only through the server-only key boundary', () => {
    expect(resolveSupabaseServiceEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_server_only_key',
    })).toEqual({
      serviceRoleKey: 'sb_secret_server_only_key',
      url: 'https://project.supabase.co',
    });
    expect(() => resolveSupabaseServiceEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_not_elevated',
    })).toThrow(/server-only/);
  });
});
