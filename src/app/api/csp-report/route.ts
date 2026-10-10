import { NextRequest } from 'next/server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { cspViolations } from '@/lib/csp-report';

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
    // Only real violations — every one in a Reporting API batch; the batch's
    // other report types (deprecation, intervention…) are not errors.
    for (const v of cspViolations(raw)) reportRouteError('[csp-report]', JSON.stringify(v));
  } catch { /* a failed report must never surface */ }
  return new Response(null, { status: 204 });
}
