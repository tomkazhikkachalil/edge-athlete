/**
 * Absolute-URL base for org-site SEO surfaces (phase 3 R4) — the repo's
 * first absolute-URL helper. Everything derives from NEXT_PUBLIC_APP_URL
 * so the canonical-domain question (vercel.app today, a real apex later)
 * is an env/ops decision, never a code change. No trailing slash.
 */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app').replace(
    /\/$/,
    ''
  );
}

// ── The one canonical-path seam (phase 6 R2) ────────────────────────────────
// Every public org-site URL mint (canonicals, OG, JSON-LD, sitemap, nav
// links) funnels through orgSitePath so the canonical flip is a FLAG, not
// a sweep. NEXT_PUBLIC_VANITY_CANONICAL=1 (build-injected, the fifth such
// flag) makes /{slug} the org's address — Tom's call, the NHL.com/team
// model; off keeps /org/{slug}. Canonical only ever flips ON where the
// vanity tree (R1's NEXT_PUBLIC_VANITY_ORG_PATHS) is also on — the
// middleware 301 requires both.
export function orgSitePath(slug: string): string {
  return process.env.NEXT_PUBLIC_VANITY_CANONICAL === '1' ? `/${slug}` : `/org/${slug}`;
}

// ── The custom-domain render seam (phase 6b C2) ─────────────────────────────
// Once a site's own domain is ACTIVE (C1's reachability proof), the ISR
// document for /{slug} is only ever seen on that host (the apex 301s), so
// its links must be host-relative WITHOUT the slug prefix, and its
// canonical/OG/JSON-LD URLs absolute on the domain. Every public mint
// funnels through these two so activation is a row state, not a sweep.

export interface SiteAddress {
  subdomain: string;
  custom_domain?: string | null;
  domain_active_at?: string | null;
}

export function siteDomainActive(site: SiteAddress): boolean {
  return !!site.custom_domain && !!site.domain_active_at;
}

/** Root-relative base for links inside the site: '' on an active custom
 *  domain (so `${base}/teams` = /teams), else the canonical org path. */
export function siteBasePath(site: SiteAddress): string {
  return siteDomainActive(site) ? '' : orgSitePath(site.subdomain);
}

/** Absolute URL of the site's home — canonicals, OG, JSON-LD, sitemaps. */
export function siteAbsoluteUrl(site: SiteAddress): string {
  return siteDomainActive(site)
    ? `https://${site.custom_domain}`
    : `${appBaseUrl()}${orgSitePath(site.subdomain)}`;
}
