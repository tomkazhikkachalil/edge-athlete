// Sentry — browser side. Inert until NEXT_PUBLIC_SENTRY_DSN is set (local
// dev without the env var runs exactly as before). Captures unhandled
// client errors + the error boundaries' explicit captures.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Keep the free tier healthy: sample 10% of performance traces, no
  // session replay. Errors themselves are always sent.
  tracesSampleRate: 0.1,

  // Athlete data is personal — never attach request bodies/cookies/IPs
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
