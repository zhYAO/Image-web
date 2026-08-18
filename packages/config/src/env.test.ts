import { describe, expect, it } from 'vitest';

import { parsePublicEnv, parseWebServerEnv, parseWorkerEnv } from './env.js';

const publicValues = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-placeholder',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
};

describe('parsePublicEnv', () => {
  it('returns only the two approved browser variables', () => {
    expect(parsePublicEnv(publicValues)).toEqual(publicValues);
  });

  it('rejects server-only credentials instead of serializing them for the browser', () => {
    expect(() =>
      parsePublicEnv({
        ...publicValues,
        SUPABASE_SECRET_KEY: 'local-secret-placeholder',
      }),
    ).toThrow(/unrecognized key/i);
  });

  it('rejects a missing publishable key', () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: publicValues.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow();
  });
});

describe('server environment parsing', () => {
  it('requires the Web server SMTP and Supabase settings', () => {
    expect(() => parseWebServerEnv({ ...publicValues })).toThrow();
  });

  it('accepts the documented Worker concurrency boundary', () => {
    expect(
      parseWorkerEnv({
        LOG_LEVEL: 'info',
        SUPABASE_SECRET_KEY: 'local-secret-placeholder',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        WORKER_CONCURRENCY: '2',
      }).WORKER_CONCURRENCY,
    ).toBe(2);
  });

  it.each(['0', '3', 'not-a-number'])('rejects unsupported Worker concurrency %s', (value) => {
    expect(() =>
      parseWorkerEnv({
        LOG_LEVEL: 'info',
        SUPABASE_SECRET_KEY: 'local-secret-placeholder',
        SUPABASE_URL: 'http://127.0.0.1:54321',
        WORKER_CONCURRENCY: value,
      }),
    ).toThrow();
  });
});

