// ── Subdomain → path 301 (phase 3 R4) — pure, ZERO imports ─────────────────
// {slug}.<appHost> redirects to https://<appHost>/org/{slug}. Pure so the
// middleware (edge bundle) imports one tiny function and the full matrix
// is vitest-covered — the real DNS wildcard is Tom's ops step, so the
// tests ARE the verification until it exists. The apex derives from
// NEXT_PUBLIC_APP_URL at the call site: no domain is ever hardcoded.

const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Returns the absolute 301 target, or null to pass the request through.
 *  Null for: the app host itself, www.<appHost>, hosts that aren't a
 *  single label under <appHost>, and labels that aren't DNS-shaped. */
export function computeSubdomainRedirect(
  host: string | null,
  appHost: string,
  pathname: string,
  search: string
): string | null {
  if (!host) return null;
  const bare = host.toLowerCase().split(':')[0];
  const apex = appHost.toLowerCase().split(':')[0];
  if (bare === apex || bare === `www.${apex}`) return null;
  if (!bare.endsWith(`.${apex}`)) return null;
  const label = bare.slice(0, -(apex.length + 1));
  if (label === 'www' || label.includes('.') || !DNS_LABEL_RE.test(label)) return null;
  // Root path stays bare — /org/{slug}/ would eat Next's trailing-slash
  // 308 as a second hop.
  const path = pathname === '/' ? '' : pathname;
  return `https://${apex}/org/${label}${path}${search}`;
}
