// Sentry — Node server side (API routes, server components). Inert until
// the DSN env var is set. Environment + trace sampling come from the shared
// resolver so server, edge and browser agree on what 'preview' means.
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
