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
