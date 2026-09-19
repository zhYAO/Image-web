import * as Sentry from '@sentry/nextjs';

import { sanitizeSentryEvent } from '@/lib/sentry/sanitize-event';

Sentry.init({
  beforeSend: sanitizeSentryEvent,
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0'),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
