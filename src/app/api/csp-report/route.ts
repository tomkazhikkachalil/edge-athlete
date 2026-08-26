import { NextRequest } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/csp-report — CSP violation sink (hardening round).
 *
 * Browsers post here via BOTH mechanisms the policy declares: legacy
 * `report-uri` (Content-Type application/csp-report) and Reporting-API
 * `report-to` (application/reports+json). Contract with the browser:
 * ALWAYS 204, even on rate limit or garbage — a 4xx/5xx makes some browsers
 * retry-loop the report. Body is size-capped and parse-tolerant; a truncated
 * summary goes to console.error (Sentry ingests server logs), never echoed.
 * Anonymous by design (violations happen to signed-out visitors too).
 */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, 'csp-report');
    if (limited) return new Response(null, { status: 204 }); // never 429 a reporter

    const raw = (await request.text()).slice(0, MAX_BODY_BYTES);
    let summary = raw.slice(0, 500);
    try {
      const parsed = JSON.parse(raw);
      // report-uri shape: { "csp-report": {...} }; report-to: [{ body: {...} }]
      const body = parsed?.['csp-report'] ?? (Array.isArray(parsed) ? parsed[0]?.body : parsed);
      if (body && typeof body === 'object') {
        summary = JSON.stringify({
          directive: body['violated-directive'] ?? body.effectiveDirective,
          blocked: String(body['blocked-uri'] ?? body.blockedURL ?? '').slice(0, 200),
          page: String(body['document-uri'] ?? body.documentURL ?? '').slice(0, 200),
          sample: String(body['script-sample'] ?? body.sample ?? '').slice(0, 100),
        });
      }
    } catch { /* keep the raw slice */ }
    console.error('[csp-report]', summary);
  } catch { /* a failed report must never surface */ }
  return new Response(null, { status: 204 });
}
