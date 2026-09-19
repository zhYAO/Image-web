import * as Sentry from '@sentry/nextjs';

import { sanitizeSentryEvent } from '@/lib/sentry/sanitize-event';

Sentry.init({
  beforeSend: sanitizeSentryEvent,
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
});
