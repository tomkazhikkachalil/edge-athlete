// Next.js instrumentation hook. Since the boot diet (performance program
// PR 1c, Nov 2026) it loads NOTHING at boot: the Sentry server SDK — ~420 ms
// of module evaluation on this Mac, most of a second on Vercel — is imported
// and initialised on the first error instead (src/lib/observability/
// sentry-server.ts), on the Node runtime and the edge alike. Uncaught server
// errors (route handlers, RSC) still reach Sentry through `onRequestError`;
// the reported ones through the same module. Everything stays a no-op until
// NEXT_PUBLIC_SENTRY_DSN is set. The sentry.server.config.ts /
// sentry.edge.config.ts files are gone: the init lives in sentry-server.ts.
import { captureRequestError } from '@/lib/observability/sentry-server';

export async function register() {
  /* nothing at boot — see the header */
}

export const onRequestError = captureRequestError;
