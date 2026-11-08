'use client';

// ── Sentry in the browser, loaded on the first ERROR, never on page load ──────
// (the browser boot diet — performance program Phase 3b, Nov 2026)
//
// WHY. The browser SDK was ~60 KB gzipped of the ~190 KB every page loaded
// (two root chunks, Nov 7 2026), downloaded, parsed and run on every open of
// every page — to send nothing on the vast majority of them (tracing and
// sessions are off since Phase 2d; errors are rare). Now the page installs two
// tiny handlers (`error`, `unhandledrejection`) that BUFFER what happens, and
// the SDK is imported and initialised on the first error — the buffered ones
// go first, then everything flows exactly as before. The React error
// boundaries and the explicit callers use the same lazy calls.
//
// What is given up: breadcrumbs from before the first error (the console and
// network trail leading up to it). What is kept: every error, with the same
// config (sentry-env.ts), the same beacon rules (no session, no tracing, no
// client reports). `src/lib/__tests__/sentry-lazy.test.ts` pins that no
// module imports '@sentry/nextjs' statically on either side.

import type * as SentryTypes from '@sentry/nextjs';
import { browserBeaconIntegrations, resolveSentryConfig } from './sentry-env';

type Sdk = typeof SentryTypes;
type Buffered = { kind: 'exception'; value: unknown } | { kind: 'message'; value: string; level: 'warning' | 'error' };

let sdkPromise: Promise<Sdk> | null = null;
let installed = false;
const buffer: Buffered[] = [];
const BUFFER_MAX = 20;

/** The SDK, imported and initialised once; shared by every caller. */
export function sentryBrowser(): Promise<Sdk> {
  sdkPromise ??= import('@sentry/nextjs').then((sdk) => {
    sdk.init({
      integrations: browserBeaconIntegrations,
      sendClientReports: false,
      ...resolveSentryConfig({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        explicitEnv: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        // NEXT_PUBLIC_VERCEL_ENV, NOT VERCEL_ENV: Next inlines only NEXT_PUBLIC_* here.
        vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV,
        nodeEnv: process.env.NODE_ENV,
      }),
    });
    // Whatever happened before the SDK arrived goes first, in order.
    for (const b of buffer.splice(0)) {
      if (b.kind === 'exception') sdk.captureException(b.value);
      else sdk.captureMessage(b.value, { level: b.level });
    }
    return sdk;
  });
  return sdkPromise;
}

const swallow = () => {
  /* reporting is a nicety — a failure to report never becomes a second error */
};

export function captureException(error: unknown, hint?: Parameters<Sdk['captureException']>[1]): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void sentryBrowser().then((sdk) => sdk.captureException(error, hint)).catch(swallow);
}

export function captureMessage(message: string, context?: Parameters<Sdk['captureMessage']>[1]): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void sentryBrowser().then((sdk) => sdk.captureMessage(message, context)).catch(swallow);
}

/**
 * The page-load part: two handlers that remember what happened until the SDK
 * is here, and ask for it. Idempotent; a no-op without a DSN or a window.
 */
export function installBrowserErrorHandlers(): void {
  if (installed || typeof window === 'undefined' || !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  installed = true;
  const remember = (b: Buffered) => {
    if (buffer.length < BUFFER_MAX) buffer.push(b);
    void sentryBrowser().catch(swallow);
  };
  window.addEventListener('error', (event) => {
    remember({ kind: 'exception', value: event.error ?? new Error(event.message || 'window error') });
  });
  window.addEventListener('unhandledrejection', (event) => {
    remember({ kind: 'exception', value: event.reason ?? new Error('unhandled rejection') });
  });
}
