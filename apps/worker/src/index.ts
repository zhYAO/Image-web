import { createLogger, parseWorkerEnv } from '@zima/config';

const env = parseWorkerEnv({
  LOG_LEVEL: process.env.LOG_LEVEL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
});

const logger = createLogger({
  level: env.LOG_LEVEL,
  service: 'worker',
});

logger.info(
  {
    workerConcurrency: env.WORKER_CONCURRENCY,
  },
  'worker_foundation_ready',
);

