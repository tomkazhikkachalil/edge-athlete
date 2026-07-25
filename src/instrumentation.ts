// Next.js instrumentation hook — loads the right Sentry init per runtime
// and forwards UNCAUGHT server errors (route handlers, RSC) to Sentry.
// Everything here is a no-op until NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
