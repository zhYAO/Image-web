import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info');
const localOrHttpsUrlSchema = z.url().refine(
  (value) => value.startsWith('https://') || value.startsWith('http://127.0.0.1') || value.startsWith('http://localhost'),
  'Supabase URL must use HTTPS except for local development',
);

const publicEnvSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    NEXT_PUBLIC_SUPABASE_URL: localOrHttpsUrlSchema,
  })
  .strict();

const webServerEnvSchema = z
  .object({
    LOG_LEVEL: logLevelSchema,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    NEXT_PUBLIC_SUPABASE_URL: localOrHttpsUrlSchema,
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SUPABASE_SECRET_KEY: z.string().trim().min(1),
  })
  .strict();

const workerEnvSchema = z
  .object({
    LOG_LEVEL: logLevelSchema,
    SUPABASE_SECRET_KEY: z.string().trim().min(1),
    SUPABASE_URL: localOrHttpsUrlSchema,
    WORKER_CONCURRENCY: z.coerce.number().int().min(2).max(2),
  })
  .strict();

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const parsePublicEnv = (input: unknown): PublicEnv => publicEnvSchema.parse(input);

export const parseWebServerEnv = (input: unknown): WebServerEnv => webServerEnvSchema.parse(input);

export const parseWorkerEnv = (input: unknown): WorkerEnv => workerEnvSchema.parse(input);

