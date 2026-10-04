/**
 * The installed app's static cache (speed round 2, phase E — Oct 4 2026).
 * Pure, zero imports; the service worker (public/sw.js) and the registrar
 * share these rules by copy — the worker is plain JS and cannot import.
 *
 * What it is: the service worker answers `/_next/static/*` from a cache,
 * cache-first. Those files are content-hashed and immutable, so a cached copy
 * is never stale — and on a phone that just reopened the installed app they
 * are the first ~450 KB it would otherwise ask the network for. NOTHING else
 * is touched: documents, `/api/*`, images, push and `/sw.js` itself all pass
 * straight through (the worker never calls respondWith for them).
 *
 * Why a flag: the Oct 2 attempt (a cache-first handler on the same files)
 * stalled Playwright WebKit's `getRegistration` and the bell's fetch while the
 * worker controlled the page, and a real-iPhone problem could not be ruled
 * out without a device. `NEXT_PUBLIC_SW_STATIC_CACHE=1` turns it on for a
 * deployment; Preview first, then Tom's phone is the gate. The flag is
 * BUILD-INJECTED (NEXT_PUBLIC_*) — a real build, not a redeploy.
 *
 * How the worker knows: it is registered as `/sw.js?static=1` when the flag
 * is on. A worker's URL is its identity, so both the push opt-in and the boot
 * registration MUST use the same one (`swUrl`) or the browser would swap
 * workers back and forth.
 */

export const STATIC_CACHE_QUERY = 'static=1';

// Read as a STATIC member expression so Next inlines it into the client
// bundle (`env.X` through a parameter is never replaced — the first cut did
// that and the registrar read `undefined` in every browser).
const FLAG = process.env.NEXT_PUBLIC_SW_STATIC_CACHE;

export function staticCacheEnabled(value: string | undefined = FLAG): boolean {
  return value === '1';
}

/** The ONE service-worker URL for this deployment — every registration uses it. */
export function swUrl(enabled: boolean): string {
  return enabled ? `/sw.js?${STATIC_CACHE_QUERY}` : '/sw.js';
}

/** The only requests the worker may answer from its cache. */
export function isStaticAssetPath(pathname: string): boolean {
  return pathname.startsWith('/_next/static/') && !pathname.includes('..');
}
