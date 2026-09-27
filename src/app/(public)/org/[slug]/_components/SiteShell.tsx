import Image from 'next/image';
import Link from 'next/link';
import { orgLogoUrl } from '@/lib/media/org-site-media';
import {
  MODULE_SUBPAGE_KEYS,
  moduleLabel,
  parseContact,
  parseFooterConfig,
  parseHeroConfig,
  parseNavConfig,
  parseSponsors,
  parseThemeTokens,
  SOCIAL_NETWORKS,
  type SocialNetwork,
} from '@/lib/org-sites/validate';
import { tierRank } from '@/lib/site-builder/display';
import SocialIcon from './SocialIcon';
import SponsorsList from './SponsorsList';
import { utcToday } from '@/lib/competitions/golf-weeks';
import { appBaseUrl, siteBasePath } from '@/lib/org-sites/urls';
import { effectiveSpec, fontFaceCss, fontHref, themeAttrs } from '@/lib/org-sites/theme';
import type { PublicSite } from '@/lib/org-sites/server';
import type { PublicPageLink } from '@/lib/org-sites/public-data';
import { navEntries } from '@/lib/org-sites/nav';
import { activeBanner, type BannerNotice } from '@/lib/org-sites/banner';
import { groupTeamsForNav, type NavTeamInput } from '@/lib/org-sites/nav-groups';
import { SiteMenu, SiteNavInline, type SiteNavLink } from './SiteNav';

// ── The site shell (phase 3 R1, nav in R2; extracted in Site Builder P2-B) ──
// The header (bar or band), the nav strip of ENABLED subpage modules + public
// custom pages, the notice band, the footer — rendered around every page of
// a site. Props-only and server-safe: the PUBLISHED layout feeds it cached
// reads; the DRAFT preview (its own route group, outside the published-only
// layout) feeds it the draft-overlaid site, so a manager previews the draft
// theme, template, nav and notice — not the live ones around a draft body.
// Viewer-independent by construction (the standings contract).

// L4: the notice band's tones as LITERAL classes (Tailwind sees them; the
// tone itself is a validated enum from parseHeroConfig / activeBanner).
const BANNER_TONE_CLASS = {
  warning: 'bg-amber-50 border-b border-amber-200 text-amber-900',
  info: 'bg-sky-50 border-b border-sky-200 text-sky-900',
  alert: 'bg-red-700 border-b border-red-800 text-white',
} as const;

export default function SiteShell({
  site,
  pages,
  notices = [],
  navTeams = [],
  children,
}: {
  site: PublicSite;
  pages: PublicPageLink[];
  /** P0-2: announcements sent "on the site until …" (newest first) — the
   *  band is derived from them at render, never copied into hero_config. */
  notices?: readonly BannerNotice[];
  /** L1: the teams the header's Teams dropdown lists — the caller passes them
   *  only when the teams page is public (module on, not members-only). */
  navTeams?: readonly NavTeamInput[];
  children: React.ReactNode;
}) {
  // B1: nav follows the modules' sort_order (set_nav mirrors the list
  // into it) and honours label overrides from nav_config.
  const nav = parseNavConfig(site.nav_config);
  const navKeys = site.modules
    .filter(m => m.enabled && (MODULE_SUBPAGE_KEYS as readonly string[]).includes(m.module_key))
    .map(m => m.module_key);
  // Program 2, B4: modules and pages in ONE list — stored entries first,
  // then the unlisted modules, then the unlisted listed pages by creation
  // time (an untouched site renders exactly the header it always did).
  const entries = navEntries(nav, navKeys, pages.map(p => ({ ...p, visibility: 'public' as const })));

  // Strict per-key re-validation at render (parseThemeTokens, inside
  // themeAttrs) is the inline-style injection defense — never interpolate
  // the raw jsonb. Phase 7: the accent vars, the heading-font property and
  // the data attributes all come from one helper the editor canvas shares.
  const tokens = parseThemeTokens(site.theme_token_set);
  const hero = parseHeroConfig(site.hero_config);
  const banner = activeBanner(hero, notices, utcToday());
  // Program 2, C: the manager's footer — a line, up to six links, the
  // contact card's socials when asked; "Powered by Edge Athlete" stays.
  const footer = parseFooterConfig(site.footer_config);
  // L3: the socials in the house order, as [network, url] — icons, not words.
  const socialLinks = (social: Partial<Record<string, string>> | undefined): [SocialNetwork, string][] =>
    SOCIAL_NETWORKS.flatMap(n => (typeof social?.[n] === 'string' && social[n] ? [[n, social[n] as string] as [SocialNetwork, string]] : []));
  const socials = footer.showSocials ? socialLinks(parseContact(site.contact_config).social) : [];
  // L3: the sponsor strip — the Sponsors module's list (when it is on), top tier first.
  const sponsorsModule = site.modules.find(m => m.module_key === 'sponsors' && m.enabled);
  const barSponsors = footer.sponsorBar !== 'off' && sponsorsModule ? [...parseSponsors(sponsorsModule.config)].sort((a, b) => tierRank(a.tier) - tierRank(b.tier)) : [];
  const sponsorBar = barSponsors.length > 0 && (
    <section aria-label="Our sponsors" className="border-y border-border bg-surface" data-site-sponsor-bar={footer.sponsorBar}>
      <div className="site-container px-4 py-3 flex items-center gap-4">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-tertiary">Sponsors</p>
        <div className="min-w-0 flex-1">
          <SponsorsList sponsors={barSponsors} siteId={site.id} variant="row" logoSize="sm" />
        </div>
      </div>
    </section>
  );
  const hasFooterContent = !!footer.text || footer.links.length > 0 || socials.length > 0;
  const brandName = tokens.wordmark ?? site.orgName;
  const attrs = themeAttrs(site);
  // A chosen heading face: its @font-face + preload, only on this site.
  const fontCss = fontFaceCss(tokens.typeface);
  const fontUrl = fontHref(tokens.typeface);
  // B2 → phase 7: the template decides the header shape until a theme
  // token overrides it — 'bar' is the R1 markup, 'band' is one strong-
  // accent band with the nav inside it.
  const spec = effectiveSpec(site);
  const tone = spec.header;
  const band = tone === 'band';
  const pro = tone === 'pro';
  const base = siteBasePath(site);

  // L1: ONE link list rendered twice — the md+ row (SiteNavInline) and the
  // phone menu (SiteMenu). Same order as ever: Home, then the entries.
  const groupedTeams = groupTeamsForNav(navTeams);
  const links: SiteNavLink[] = [{ key: 'home', href: base || '/', label: 'Home' }];
  for (const entry of entries) {
    if (entry.kind === 'module') {
      links.push({
        key: `m:${entry.key}`,
        href: `${base}/${entry.key}`,
        label: moduleLabel(entry.key, nav, site.side, site.sportKey),
        ...(entry.key === 'teams' && groupedTeams.groups.length > 0
          ? { teams: { ...groupedTeams, allHref: `${base}/teams`, teamHrefPrefix: `${base}/teams/` } }
          : {}),
      });
      // P4: a golf org's "This week" hub rides the standings module.
      if (site.sportKey === 'golf' && entry.key === 'standings') links.push({ key: 'week', href: `${base}/week`, label: 'This week' });
    } else {
      links.push({ key: `p:${entry.slug}`, href: `${base}/${entry.slug}`, label: entry.title });
    }
  }
  const hasNav = entries.length > 0;

  // The pro header's utility strip: how to reach the club, and its socials.
  const contact = parseContact(site.contact_config);
  const stripSocials = socialLinks(contact.social);
  const stripContact = [contact.phone, contact.email].filter((v): v is string => typeof v === 'string' && !!v);

  const logo = (size: number) =>
    site.logo_path ? (
      // Streamed through the tokenless org-logo proxy; /api/media/*
      // is never optimizer-eligible, so unoptimized is mandatory.
      <Image src={orgLogoUrl(site.id, site.logo_path)!} alt="" width={size} height={size} unoptimized className="rounded shrink-0" />
    ) : null;

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
      {pro ? (
        // L1: the sports header — a thin accent strip (contact + socials),
        // then a large logo band with the menu, an accent rule underneath.
        <header data-site-header="pro" className="bg-surface border-b-4" style={{ borderColor: 'var(--org-accent)' }}>
          <div className="text-white" style={{ backgroundColor: 'var(--org-accent-strong)' }}>
            {stripContact.length > 0 || stripSocials.length > 0 ? (
              <div className="site-container px-4 py-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
                <span className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {stripContact.map(v => (
                    <span key={v} className="truncate">{v}</span>
                  ))}
                </span>
                {stripSocials.length > 0 && (
                  <ul className="flex flex-wrap items-center gap-x-3" aria-label="Social links">
                    {stripSocials.map(([network, url]) => (
                      <li key={network}>
                        <a href={url} rel="noopener nofollow" className="inline-flex text-white/90 hover:text-white">
                          <SocialIcon network={network} size={16} />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="h-1.5" />
            )}
          </div>
          <div className="site-container px-4 py-4 flex items-center justify-between gap-3">
            <Link href={`${base}`} className="min-w-0 flex items-center gap-3">
              {logo(56)}
              {/* The site's heading face when it picked one (the var is set by
                  themeAttrs from the re-validated tokens; else the body face). */}
              <span
                className="block min-w-0 text-2xl sm:text-3xl font-extrabold uppercase tracking-wide truncate text-primary"
                style={{ fontFamily: 'var(--org-heading-font, inherit)' }}
                data-site-wordmark=""
              >
                {brandName}
              </span>
            </Link>
            {hasNav && <SiteMenu links={links} tone={tone} />}
          </div>
          {hasNav && <SiteNavInline links={links} tone={tone} />}
        </header>
      ) : (
        <header
          className={band ? 'text-white' : 'bg-surface border-b border-border'}
          style={band ? { backgroundColor: 'var(--org-accent-strong)' } : undefined}
        >
          <div className="site-container px-4 py-4 flex items-center justify-between gap-2">
            <Link href={`${base}`} className="min-w-0 flex items-center gap-3">
              {logo(40)}
              {/* block, not inline — truncate's ellipsis only works on a
                  block box, and an inline span's nowrap overflows 375px. */}
              <span
                className={`block min-w-0 text-xl font-bold truncate ${band ? 'text-white' : 'text-primary'}`}
              >
                {brandName}
              </span>
            </Link>
            {hasNav && <SiteMenu links={links} tone={tone} />}
          </div>
          {hasNav && <SiteNavInline links={links} tone={tone} />}
        </header>
      )}
      {footer.sponsorBar === 'header' && sponsorBar}
      {/* S1: the notice ("Cart path only until Friday") — every page
          carries it, no dismiss (ISR renders it the same for everyone),
          until its end date. Boundary reads ≤300s stale, like the rest.
          P0-2: an active announcement beats the standing hero notice. */}
      {banner && (
        <aside
          role="status"
          aria-label="Notice"
          data-site-notice={banner.tone}
          className={BANNER_TONE_CLASS[banner.tone]}
        >
          <p className="site-container px-4 py-2 text-sm">
            {banner.tone === 'alert' && <span className="mr-2 font-bold uppercase tracking-wide">Urgent</span>}
            {banner.text}
            {banner.href && (
              <>
                {' '}
                <a href={banner.href} rel="noopener nofollow" className="font-semibold underline">
                  More →
                </a>
              </>
            )}
          </p>
        </aside>
      )}
      <main id="main" className="flex-1">{children}</main>
      {footer.sponsorBar === 'footer' && sponsorBar}
      <footer className="border-t border-border" data-site-footer="">
        {hasFooterContent && (
          <div className="site-container px-4 pt-6 pb-2 space-y-2 text-sm text-secondary">
            {footer.text && <p className="text-primary">{footer.text}</p>}
            {footer.links.length > 0 && (
              <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Footer links">
                {footer.links.map(l => (
                  <li key={l.url}>
                    <a href={l.url} rel="noopener nofollow" className="text-brand-fg hover:underline">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {socials.length > 0 && (
              <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Social links">
                {socials.map(([network, url]) => (
                  <li key={network}>
                    <a href={url} rel="noopener nofollow" className="inline-flex rounded-full p-1.5 text-brand-fg hover:bg-brand-soft">
                      <SocialIcon network={network} size={20} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="site-container px-4 py-4 text-xs text-muted">
          Powered by{' '}
          <Link href="/" className="text-brand-fg">
            Edge Athlete
          </Link>
          {/* Authority (240): anyone can report a site. An ABSOLUTE link to the app's org page
              (?report=1 opens the sheet) — it works on a custom domain, and it is static, so the
              page stays viewer-independent. */}
          {' · '}
          <a href={`${appBaseUrl()}/${site.side}/${site.orgId}?report=1`} rel="nofollow" className="text-muted underline" data-site-report="">
            Report this site
          </a>
        </div>
        {/* Program 2, E: the first-party page-view pixel — a plain <img> on
            purpose (never the optimizer: the route is no-store and counts
            on every fetch; the page it sat on rides the same-origin Referer). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a 1x1 no-store counting pixel; the optimizer would cache it */}
        <img src={`${siteBasePath(site)}/hit.gif`} alt="" width={1} height={1} aria-hidden="true" decoding="async" className="absolute h-px w-px opacity-0" data-site-pixel="" />
      </footer>
    </div>
  );
}
