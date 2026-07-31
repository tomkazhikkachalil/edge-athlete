// Sentry — Edge runtime (middleware). Inert until the DSN env var is set.
// Kept option-for-option identical to sentry.server.config.ts.
import * as Sentry from '@sentry/nextjs';
import { resolveSentryConfig } from '@/lib/observability/sentry-env';

Sentry.init(
  resolveSentryConfig({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    explicitEnv: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    vercelEnv: process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  })
);
