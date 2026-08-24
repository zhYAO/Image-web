import { z } from 'zod';

const serviceEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(16),
});

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

export function resolveSupabaseServiceEnv(input: Record<string, string | undefined>) {
  const parsed = serviceEnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new Error('Supabase server-only environment is invalid.');

  const key = parsed.data.SUPABASE_SERVICE_ROLE_KEY;
  if (!key.startsWith('sb_secret_') && jwtRole(key) !== 'service_role') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must contain a server-only elevated key.');
  }

  return {
    serviceRoleKey: key,
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
  };
}
