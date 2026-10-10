/**
 * Read a CSP report POST into the violations worth logging. Pure; zero imports.
 *
 * Browsers post BOTH shapes the policy asks for: legacy `report-uri`
 * (`{ "csp-report": {…} }`) and the Reporting API's `report-to` — a BATCH
 * (`[{ type, body }, …]`) that also carries the endpoint group's other report
 * types (deprecation, intervention, …). The route used to read only the
 * batch's first item as if it were a violation: other types logged as empty
 * `{"blocked":"","page":"","sample":""}` errors (32 in a day — the Oct 9 2026
 * log sweep), and a real violation later in a batch was never logged.
 */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  sample: string;
}

const MAX_PER_POST = 5;

function fromBody(body: Record<string, unknown>): CspViolation | null {
  const directive = String(body['violated-directive'] ?? body['effective-directive'] ?? body.effectiveDirective ?? '');
  if (!directive) return null;
  return {
    directive: directive.slice(0, 80),
    blocked: String(body['blocked-uri'] ?? body.blockedURL ?? '').slice(0, 200),
    page: String(body['document-uri'] ?? body.documentURL ?? '').slice(0, 200),
    sample: String(body['script-sample'] ?? body.sample ?? '').slice(0, 100),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function cspViolations(raw: string): CspViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (isObject(item) && item.type === 'csp-violation' && isObject(item.body)) bodies.push(item.body);
    }
  } else if (isObject(parsed)) {
    if (isObject(parsed['csp-report'])) bodies.push(parsed['csp-report']);
    else if (parsed.type === 'csp-violation' && isObject(parsed.body)) bodies.push(parsed.body);
  }
  const out: CspViolation[] = [];
  for (const b of bodies) {
    const v = fromBody(b);
    if (v) out.push(v);
    if (out.length >= MAX_PER_POST) break;
  }
  return out;
}
