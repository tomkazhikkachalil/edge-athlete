// ── Sentry on the server, loaded on the first ERROR, never at boot ───────────
// (the boot diet — performance program PR 1c, Nov 2026)
//
// WHY. `require('@sentry/nextjs')` costs ~420 ms on an M-series Mac — most of
// a second on Vercel's CPU — and until this file it ran at BOOT for every
// function: `instrumentation.ts` imported it to wire `onRequestError`, and 21
// server modules (route handlers, the rate limiter, the mailer, account
// deletion) imported it statically to report a failure that almost never
// happens. A deploy-cold request measured 1.7–2.2 s per route against ~150 ms
// warm (docs/load/2026-11-07/cold-after.md), and the package diet had not
// moved it: the floor is module evaluation, and this was the largest module.
//
// WHAT. The same three calls the callers used (`captureException`,
// `captureMessage`, `addBreadcrumb`), fire-and-forget: the first one imports
// the SDK, inits it with the project's resolved config (sentry-env.ts) and
// then forwards; every later call forwards at once. Errors reach Sentry
// exactly as before — the uncaught ones through `onRequestError`
// (instrumentation.ts), the reported ones through here. What is given up:
// server-side performance TRACES and automatic breadcrumbs, which an SDK
// loaded after boot cannot hook; the project sampled 10 % of them and read
// none. The browser SDK is untouched (instrumentation-client.ts).
//
// `src/lib/__tests__/sentry-server-lazy.test.ts` pins that no server module
// imports '@sentry/nextjs' statically but this one.

import type * as SentryTypes from '@sentry/nextjs';
import { resolveSentryConfig } from './sentry-env';

type Sdk = typeof SentryTypes;
let sdkPromise: Promise<Sdk> | null = null;

/** The SDK, imported and initialised once; shared by every caller. */
export function sentry(): Promise<Sdk> {
  sdkPromise ??= import('@sentry/nextjs').then((sdk) => {
    sdk.init(
      resolveSentryConfig({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        explicitEnv: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        vercelEnv: process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV,
        nodeEnv: process.env.NODE_ENV,
      })
    );
    return sdk;
  });
  return sdkPromise;
}

const swallow = () => {
  /* reporting is a nicety — a failure to report never becomes a second error */
};

export function captureException(...args: Parameters<Sdk['captureException']>): void {
  void sentry().then((sdk) => sdk.captureException(...args)).catch(swallow);
}

export function captureMessage(...args: Parameters<Sdk['captureMessage']>): void {
  void sentry().then((sdk) => sdk.captureMessage(...args)).catch(swallow);
}

export function addBreadcrumb(...args: Parameters<Sdk['addBreadcrumb']>): void {
  void sentry().then((sdk) => sdk.addBreadcrumb(...args)).catch(swallow);
}

/** Next's `onRequestError` hook, with the SDK loaded on the first error. */
export async function captureRequestError(...args: Parameters<Sdk['captureRequestError']>): Promise<void> {
  try {
    const sdk = await sentry();
    await sdk.captureRequestError(...args);
  } catch {
    swallow();
  }
}
