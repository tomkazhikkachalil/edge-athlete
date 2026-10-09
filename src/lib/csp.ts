// ── Content-Security-Policy builder ─────────────────────────────────────────
// Owned by src/middleware.ts since the Aug 2026 hardening round (vercel.json
// carried a static REPORT-ONLY policy before — reporting to nowhere, and
// missing Sentry's ingest host from connect-src). A per-request nonce is the
// only way to enforce script-src without 'unsafe-inline': Next's own inline
// bootstrap/flight scripts vary per render (unhashable), and Next auto-nonces
// them when the incoming REQUEST carries a content-security-policy header
// with a nonce (which the middleware sets).
//
// Directive rationale (verified against the codebase before enforcement):
// * script-src: 'strict-dynamic' lets the nonce'd bootstrap load Next's
//   chunks. 'unsafe-inline' + https: are the CSP2-browser FALLBACKS — any
//   browser that understands nonces IGNORES them (the Google strict-CSP
//   recipe); they are not a hole in modern browsers. Dev adds 'unsafe-eval'
//   (Turbopack HMR) — dev is also always report-only, see the middleware.
//   'wasm-unsafe-eval' (Oct 9 2026, every-phone PR 6): WebAssembly
//   compilation ONLY — never JavaScript eval — for the HEIC decoder a
//   Samsung's high-efficiency photo needs in Chrome on Android
//   (heic-decode.ts). Without it `WebAssembly.Module()` is a CSP violation
//   and the photo was skipped. Chrome 97+ / Safari 16+ honour the token; a
//   browser that does not understand it ignores it (and no iPhone reaches
//   that decoder — Safari hands the page a JPEG).
// * style-src keeps 'unsafe-inline': React style={{}} props app-wide +
//   Leaflet's runtime-injected styles. Unavoidable today.
// * img/media: OSM + ArcGIS tiles, logo.dev, Giphy media, Supabase storage
//   ride https:; blob: is load-bearing for the media editor (object URLs).
// * connect-src: Supabase REST/realtime, the Giphy PROXY is same-origin but
//   api.giphy.com stays for any legacy direct call, and BOTH Sentry ingest
//   wildcard forms (the report-only policy silently killed browser error
//   reporting by omitting them). blob: because the media editor reads its
//   own object URLs back via fetch (caught by the enforced-CSP e2e run —
//   blob content is locally created, not an exfil channel). Dev adds
//   localhost/ws for HMR.
// * worker-src 'self' (Oct 2026, mig 248): the phone-notification service
//   worker at /sw.js. Without it the browser falls back to script-src,
//   where 'strict-dynamic' makes 'self' IGNORED — the registration would be
//   refused. Same-origin only: no blob:, no other host. The nonce-free
//   policy below has none on purpose (public sites register no worker).
// * frame-src (Site Builder phase 6): the embed widget's three providers,
//   from the one list the renderer builds frame URLs against
//   (EMBED_FRAME_HOSTS — pinned equal by test). Before it there was no
//   frame-src and an iframe fell to default-src 'self'.
// Pure and env-free (dev passed in) so it unit-tests in the node runner.

import { EMBED_FRAME_HOSTS } from '@/lib/site-builder/embeds';

export const CSP_REPORT_PATH = '/api/csp-report';

const FRAME_SRC = `frame-src ${EMBED_FRAME_HOSTS.join(' ')}`;

/**
 * The `'sha256-…'` source for ONE inline script whose text is a build-time
 * constant. Web Crypto, so it runs in the edge middleware and in node.
 *
 * Why (Oct 1 2026): the (public) root layout carries a blocking inline theme
 * script, and that layout is static — it can never hold a per-request nonce.
 * Its pages that are NOT on a static-CSP path (/clubs, /leagues, the root
 * 404) are served the nonce policy below, which blocked the script: the
 * directories stayed light for a dark-themed visitor. A hash admits exactly
 * that script and nothing else, and is honoured alongside 'strict-dynamic'.
 */
export async function inlineScriptHashSource(script: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return `'sha256-${btoa(binary)}'`;
}

export function buildCsp(nonce: string, opts?: { dev?: boolean; scriptHashes?: readonly string[] }): string {
  const dev = opts?.dev === true;
  const hashes = (opts?.scriptHashes ?? []).map(h => ` ${h}`).join('');
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'${hashes} 'strict-dynamic' 'wasm-unsafe-eval' 'unsafe-inline' https:${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    `worker-src 'self'`,
    FRAME_SRC,
    `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://api.giphy.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to csp`,
  ].join('; ');
}

/** The NONCE-FREE variant for the PUBLIC_STANDINGS_CACHE carve-out (R3
 *  spike experiment): identical policy minus the nonce and
 *  'strict-dynamic', so the CSP2 fallbacks ('unsafe-inline' + https:)
 *  become the ACTIVE script policy. That is a deliberate, measured
 *  relaxation on ONE anonymous read-only path (public standings — no
 *  session, no user data on the page), behind an env kill switch;
 *  default-src/frame-ancestors/base-uri/form-action keep their teeth.
 *  Whether this ships beyond the experiment is the spike's DEVLOG
 *  verdict. */
export function buildStaticCsp(opts?: { dev?: boolean }): string {
  const dev = opts?.dev === true;
  return [
    `default-src 'self'`,
    // V3 (sports-team website program, Sep 28 2026): no `https:` — nothing
    // behind this policy loads a third-party script (Sentry is bundled; embeds
    // are frames), so any https origin was headroom for an injected tag.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    FRAME_SRC,
    `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://api.giphy.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to csp`,
  ].join('; ');
}
