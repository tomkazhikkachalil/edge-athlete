import Image from 'next/image';
import Link from 'next/link';
import { orgLogoUrl } from '@/lib/media/org-site-media';
import {
  MODULE_SUBPAGE_KEYS,
  moduleLabel,
  noticeActive,
  parseHeroConfig,
  parseNavConfig,
  parseThemeTokens,
} from '@/lib/org-sites/validate';
import { utcToday } from '@/lib/competitions/golf-weeks';
import { siteBasePath } from '@/lib/org-sites/urls';
import { effectiveSpec, fontFaceCss, fontHref, themeAttrs } from '@/lib/org-sites/theme';
import type { PublicSite } from '@/lib/org-sites/server';
import type { PublicPageLink } from '@/lib/org-sites/public-data';

// ── The site shell (phase 3 R1, nav in R2; extracted in Site Builder P2-B) ──
// The header (bar or band), the nav strip of ENABLED subpage modules + public
// custom pages, the notice band, the footer — rendered around every page of
// a site. Props-only and server-safe: the PUBLISHED layout feeds it cached
// reads; the DRAFT preview (its own route group, outside the published-only
// layout) feeds it the draft-overlaid site, so a manager previews the draft
// theme, template, nav and notice — not the live ones around a draft body.
// Viewer-independent by construction (the standings contract).

export default function SiteShell({
  site,
  pages,
  children,
}: {
  site: PublicSite;
  pages: PublicPageLink[];
  children: React.ReactNode;
}) {
  // B1: nav follows the modules' sort_order (set_nav mirrors the list
  // into it) and honours label overrides from nav_config.
  const nav = parseNavConfig(site.nav_config);
  const navKeys = site.modules
    .filter(m => m.enabled && (MODULE_SUBPAGE_KEYS as readonly string[]).includes(m.module_key))
    .map(m => m.module_key);

  // Strict per-key re-validation at render (parseThemeTokens, inside
  // themeAttrs) is the inline-style injection defense — never interpolate
  // the raw jsonb. Phase 7: the accent vars, the heading-font property and
  // the data attributes all come from one helper the editor canvas shares.
  const tokens = parseThemeTokens(site.theme_token_set);
  const hero = parseHeroConfig(site.hero_config);
  const brandName = tokens.wordmark ?? site.orgName;
  const attrs = themeAttrs(site);
  // A chosen heading face: its @font-face + preload, only on this site.
  const fontCss = fontFaceCss(tokens.typeface);
  const fontUrl = fontHref(tokens.typeface);
  // B2 → phase 7: the template decides the header shape until a theme
  // token overrides it — 'bar' is the R1 markup, 'band' is one strong-
  // accent band with the nav inside it.
  const spec = effectiveSpec(site);
  const band = spec.header === 'band';
  const navLinkClass = band
    ? 'text-sm font-medium text-white/90'
    : 'text-sm font-medium text-secondary';

  return (
    <div className="org-scope min-h-screen flex flex-col bg-canvas" {...attrs}>
      {fontCss && fontUrl && (
        <>
          <link rel="preload" href={fontUrl} as="font" type="font/woff2" crossOrigin="anonymous" />
          <style dangerouslySetInnerHTML={{ __html: fontCss }} />
        </>
      )}
      {/* R5 a11y: keyboard users skip the header/nav straight to content.
          sr-only until focused (the global :focus-visible ring shows it). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:rounded-md focus:text-sm focus:text-primary"
      >
        Skip to content
      </a>
      <header
        className={band ? 'text-white' : 'bg-surface border-b border-border'}
        style={band ? { backgroundColor: 'var(--org-accent-strong)' } : undefined}
      >
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={`${siteBasePath(site)}`} className="min-w-0 flex items-center gap-3">
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
            <span
              className={`block min-w-0 text-xl font-bold truncate ${band ? 'text-white' : 'text-primary'}`}
            >
              {brandName}
            </span>
          </Link>
        </div>
        {navKeys.length + pages.length > 0 && (
          <nav aria-label="Site navigation" className="max-w-4xl mx-auto px-4 pb-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Link href={`${siteBasePath(site)}`} className={navLinkClass}>
                Home
              </Link>
              {navKeys.map(key => (
                <Link
                  key={key}
                  href={`${siteBasePath(site)}/${key}`}
                  className={navLinkClass}
                >
                  {moduleLabel(key, nav, site.side, site.sportKey)}
                </Link>
              ))}
              {/* P4: a golf org's "This week" hub rides the standings module. */}
              {site.sportKey === 'golf' && navKeys.includes('standings') && (
                <Link href={`${siteBasePath(site)}/week`} className={navLinkClass}>
                  This week
                </Link>
              )}
              {pages.map(p => (
                <Link
                  key={p.slug}
                  href={`${siteBasePath(site)}/${p.slug}`}
                  className={navLinkClass}
                >
                  {p.title}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>
      {/* S1: the notice ("Cart path only until Friday") — every page
          carries it, no dismiss (ISR renders it the same for everyone),
          until its end date. Boundary reads ≤300s stale, like the rest. */}
      {noticeActive(hero, utcToday()) && (
        <aside
          role="status"
          aria-label="Notice"
          className="bg-amber-50 border-b border-amber-200 text-amber-900"
        >
          <p className="max-w-4xl mx-auto px-4 py-2 text-sm">{hero.notice}</p>
        </aside>
      )}
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
