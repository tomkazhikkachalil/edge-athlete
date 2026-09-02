import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCachedPages, getCachedSite } from '@/lib/org-sites/cached';
import { orgLogoUrl } from '@/lib/media/org-site-media';
import type { Metadata } from 'next';
import {
  MODULE_SUBPAGE_KEYS,
  moduleLabel,
  parseNavConfig,
  parseThemeTokens,
  resolveAccentPair,
} from '@/lib/org-sites/validate';
import { orgSitePath } from '@/lib/org-sites/urls';

// ── /org/[slug] — the site shell (phase 3 R1, nav in R2) ────────────────────
// Published sites only (draft = 404, the publish gate). The fetch is
// unstable_cache'd per slug with the `org-site:{slug}` tag — the console's
// publish/edit writes revalidateTag it — plus the 300s baseline, so these
// documents are ISR: rendered once, CDN-served, refreshed on demand.
// Viewer-independent by construction (the standings contract). The nav
// strip lists only ENABLED subpage modules — a console toggle purges the
// same cache entry, so nav, home, and subpages flip together.

export const revalidate = 300;

/** Phase 6b B1: the per-site favicon — the uploaded logo when there is
 *  one (the tokenless streamer), else the generated /favicon.svg. Pages
 *  merge their own title/canonical over this; none of them sets icons. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return {};
  const icon = orgLogoUrl(site.id, site.logo_path) ?? `${orgSitePath(site.subdomain)}/favicon.svg`;
  return { icons: { icon } };
}

export default async function OrgSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  // B1: nav follows the modules' sort_order (set_nav mirrors the list
  // into it) and honours label overrides from nav_config.
  const nav = parseNavConfig(site.nav_config);
  const navKeys = site.modules
    .filter(m => m.enabled && (MODULE_SUBPAGE_KEYS as readonly string[]).includes(m.module_key))
    .map(m => m.module_key);
  // R3: public custom pages join the nav after the module links.
  const pages = await getCachedPages(slug, site.id);

  // Strict per-key re-validation at render (parseThemeTokens) is the
  // inline-style injection defense — never interpolate the raw jsonb.
  const tokens = parseThemeTokens(site.theme_token_set);
  const { accent, strong } = resolveAccentPair(tokens);
  const accentStyle =
    tokens.accent || tokens.accentStrong
      ? ({ '--org-accent': accent, '--org-accent-strong': strong } as React.CSSProperties)
      : undefined;
  const brandName = tokens.wordmark ?? site.orgName;

  return (
    <div
      className="org-scope min-h-screen flex flex-col bg-canvas"
      style={accentStyle}
      data-typeface={tokens.typeface}
      data-surface={tokens.surface}
    >
      {/* R5 a11y: keyboard users skip the header/nav straight to content.
          sr-only until focused (the global :focus-visible ring shows it). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md focus:text-sm focus:text-primary"
      >
        Skip to content
      </a>
      <header className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={`${orgSitePath(site.subdomain)}`} className="min-w-0 flex items-center gap-3">
            {site.logo_path ? (
              // Streamed through the tokenless org-logo proxy; /api/media/*
              // is never optimizer-eligible, so unoptimized is mandatory.
              <Image
                src={orgLogoUrl(site.id, site.logo_path)!}
                alt=""
                width={40}
                height={40}
                unoptimized
                className="rounded shrink-0"
              />
            ) : null}
            {/* block, not inline — truncate's ellipsis only works on a
                block box, and an inline span's nowrap overflows 375px. */}
            <span className="block min-w-0 text-xl font-bold text-primary truncate">
              {brandName}
            </span>
          </Link>
        </div>
        {navKeys.length + pages.length > 0 && (
          <nav aria-label="Site navigation" className="max-w-4xl mx-auto px-4 pb-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Link
                href={`${orgSitePath(site.subdomain)}`}
                className="text-sm font-medium text-secondary"
              >
                Home
              </Link>
              {navKeys.map(key => (
                <Link
                  key={key}
                  href={`${orgSitePath(site.subdomain)}/${key}`}
                  className="text-sm font-medium text-secondary"
                >
                  {moduleLabel(key, nav)}
                </Link>
              ))}
              {pages.map(p => (
                <Link
                  key={p.slug}
                  href={`${orgSitePath(site.subdomain)}/${p.slug}`}
                  className="text-sm font-medium text-secondary"
                >
                  {p.title}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 text-xs text-muted">
          Powered by{' '}
          <Link href="/" className="text-brand-fg">
            Edge Athlete
          </Link>
        </div>
      </footer>
    </div>
  );
}
