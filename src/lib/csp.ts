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
// * worker-src: no `new Worker` in the codebase (grep-verified Aug 2026) —
//   deliberately omitted; default-src 'self' governs if one appears.
// Pure and env-free (dev passed in) so it unit-tests in the node runner.

export const CSP_REPORT_PATH = '/api/csp-report';

export function buildCsp(nonce: string, opts?: { dev?: boolean }): string {
  const dev = opts?.dev === true;
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' blob: https://*.supabase.co wss://*.supabase.co https://api.giphy.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io${dev ? ' ws://localhost:* http://localhost:*' : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to csp`,
  ].join('; ');
}
