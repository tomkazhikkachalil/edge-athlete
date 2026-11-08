// Sentry — browser side. Inert until NEXT_PUBLIC_SENTRY_DSN is set (local
// dev without the env var runs exactly as before). Captures unhandled
// client errors + the error boundaries' explicit captures.
//
// Sampling policy lives in the shared resolver: 10% of performance traces in
// deployed environments, 0% locally, no session replay. Errors themselves are
// always sent. PII is never attached (athlete data is personal).
import * as Sentry from '@sentry/nextjs';
import { browserBeaconIntegrations, resolveSentryConfig } from '@/lib/observability/sentry-env';

// Phase 2d (Nov 2026): nothing leaves the browser without an error. The
// session envelope every page load used to send, the tracing transaction and
// the client reports were three /api/relay calls on the open path of a clean
// /feed (e2e/perf-feed.spec.ts counted them); errors go out exactly as before.
Sentry.init({
  integrations: browserBeaconIntegrations,
  sendClientReports: false,
  ...resolveSentryConfig({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    explicitEnv: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    // NEXT_PUBLIC_VERCEL_ENV, NOT VERCEL_ENV: Next inlines only NEXT_PUBLIC_*
    // (plus NODE_ENV) into the client bundle, so the unprefixed name would
    // compile to `undefined` here. And because Vercel preview builds run with
    // NODE_ENV=production, losing this value would tag every preview browser
    // event as 'production' — the exact bug this is fixing.
    vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
  }),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
