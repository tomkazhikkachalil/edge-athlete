// ── Custom-host resolution for the Edge middleware (phase 6b C2) ────────────
// ZERO imports (the subdomain.ts rule): the edge bundle pulls one tiny
// module. Two lookups, both through the anon-granted SECURITY DEFINER RPCs
// from migration 171 (THE bounded posture-A exception — they answer only
// verified host ↔ slug pairs for published sites):
//   resolveHost(host)     → { slug, active } | null   (custom host → site)
//   resolveSlugDomain(slug) → domain | null           (apex /{slug} → 301?)
// A module-level TTL map absorbs the per-request cost (Fluid/edge isolates
// are reused); misses cost one PostgREST fetch. Everything fails OPEN to
// "no mapping" — a lookup hiccup means a plain 404/normal render, never a
// 500 in middleware.

export interface HostHit {
  slug: string;
  active: boolean;
}

const TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 30_000;

const hostCache = new Map<string, { hit: HostHit | null; expires: number }>();
const slugCache = new Map<string, { domain: string | null; expires: number }>();

/** Bare lowercase host (no port); null when absent. */
export function bareHost(host: string | null): string | null {
  if (!host) return null;
  const bare = host.toLowerCase().split(':')[0].replace(/\.$/, '');
  return bare || null;
}

/** True for hosts the app itself answers: the apex, www, and its labels. */
export function isAppHost(host: string, appHost: string): boolean {
  const apex = appHost.toLowerCase().split(':')[0];
  return host === apex || host === `www.${apex}` || host.endsWith(`.${apex}`) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.vercel.app');
}

async function rpc<T>(name: string, body: Record<string, string>): Promise<T | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function resolveHost(host: string): Promise<HostHit | null> {
  const now = Date.now();
  const cached = hostCache.get(host);
  if (cached && cached.expires > now) return cached.hit;
  const rows = await rpc<{ slug: string; active: boolean }[]>('resolve_org_site_host', { p_host: host });
  const hit = rows && rows.length > 0 && rows[0].slug ? { slug: rows[0].slug, active: rows[0].active === true } : null;
  hostCache.set(host, { hit, expires: now + (hit ? TTL_MS : NEGATIVE_TTL_MS) });
  return hit;
}

export async function resolveSlugDomain(slug: string): Promise<string | null> {
  const now = Date.now();
  const cached = slugCache.get(slug);
  if (cached && cached.expires > now) return cached.domain;
  const domain = await rpc<string | null>('resolve_org_site_domain', { p_slug: slug });
  const value = typeof domain === 'string' && domain ? domain : null;
  slugCache.set(slug, { domain: value, expires: now + (value ? TTL_MS : NEGATIVE_TTL_MS) });
  return value;
}

/** Test seam: drop every cached answer. */
export function resetDomainCaches(): void {
  hostCache.clear();
  slugCache.clear();
}

export const WELL_KNOWN = '/.well-known/edge-athlete';

/** Where a request on a CUSTOM host goes inside the app. Pure. */
export function computeCustomHostRewrite(
  pathname: string,
  slug: string
): { kind: 'well-known' } | { kind: 'sitemap' | 'robots'; target: string } | { kind: 'rewrite'; target: string } {
  if (pathname === WELL_KNOWN) return { kind: 'well-known' };
  if (pathname === '/sitemap.xml') return { kind: 'sitemap', target: `/${slug}/sitemap.xml` };
  if (pathname === '/robots.txt') return { kind: 'robots', target: `/${slug}/robots.txt` };
  return { kind: 'rewrite', target: pathname === '/' ? `/${slug}` : `/${slug}${pathname}` };
}

/** The apex → active-domain 301 target for /{slug}[/...] or /org/{slug}[/...];
 *  null for the carve-outs (preview links, card.png, crawler files). Pure. */
export function computeApexDomainRedirect(
  pathname: string,
  search: string,
  slug: string,
  domain: string
): string | null {
  const prefixes = [`/org/${slug}`, `/${slug}`];
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length);
      if (rest.includes('/preview/') || rest.endsWith('/card.png') || rest.endsWith('/favicon.svg')) return null;
      if (rest === '/sitemap.xml' || rest === '/robots.txt') return null;
      return `https://${domain}${rest}${search}`;
    }
  }
  return null;
}
