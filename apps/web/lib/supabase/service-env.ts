import { z } from 'zod';

const serviceEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(16),
});

export function resolveSupabaseServiceEnv(input: Record<string, string | undefined>) {
  const parsed = serviceEnvironmentSchema.safeParse(input);
  if (!parsed.success) throw new Error('Supabase server-only environment is invalid.');

  const key = parsed.data.SUPABASE_SECRET_KEY;
  if (!key.startsWith('sb_secret_')) {
    throw new Error('SUPABASE_SECRET_KEY must contain a modern server-only sb_secret_ key.');
  }

  return {
    secretKey: key,
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
  };
}
