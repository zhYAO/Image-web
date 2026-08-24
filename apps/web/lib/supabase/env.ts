import { z } from 'zod';

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(16),
  NEXT_PUBLIC_SUPABASE_URL: z.url().refine((url) => url.startsWith('https://') || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost'), {
    message: 'must use HTTPS except for localhost development',
  }),
});

export type DataMode = 'http' | 'mock';

export interface SupabasePublicEnvironment {
  publishableKey: string;
  url: string;
}

function jwtRole(key: string): string | undefined {
  const payload = key.split('.')[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const decoded = JSON.parse(globalThis.atob(normalized)) as { role?: unknown };
    return typeof decoded.role === 'string' ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSupabasePublicEnv(
  input: Record<string, string | undefined>,
  dataMode: DataMode,
): SupabasePublicEnvironment | null {
  if (dataMode === 'mock') return null;

  const parsed = publicEnvironmentSchema.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Supabase public environment is invalid: ${fields}`);
  }

  if (jwtRole(parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) === 'service_role') {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must never contain a service_role key.');
  }

  return {
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
  };
}

export function readSupabasePublicEnv(dataMode: DataMode): SupabasePublicEnvironment | null {
  return resolveSupabasePublicEnv({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }, dataMode);
}
