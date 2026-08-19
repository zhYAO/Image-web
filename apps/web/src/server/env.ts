import { parseWebServerEnv, type WebServerEnv } from '@zima/config';

/**
 * Server-only env loader for the Next.js BFF. Reads from `process.env`
 * once at first use and caches the validated object. Throws on any drift
 * between the runtime values and the Zod schema so misconfigurations are
 * caught at startup rather than as ambiguous request failures.
 */
let cached: WebServerEnv | undefined;

export const loadServerEnv = (): WebServerEnv => {
  if (cached) return cached;
  cached = parseWebServerEnv({
    LOG_LEVEL: process.env.LOG_LEVEL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });
  return cached;
};

/**
 * Test-only helper that resets the cached env. Production code must
 * never call this; it exists so vitest can rebuild the env between
 * tests when the surrounding `process.env` shim changes.
 */
export const __resetServerEnvForTests = (): void => {
  cached = undefined;
};