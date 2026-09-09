import Image from 'next/image';
import { GOLF_TAGLINE, parseHeroConfig, parseThemeTokens } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { PublicSite } from '@/lib/org-sites/server';
import type { TemplateSpec } from '@/lib/org-sites/templates';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { appBaseUrl } from '@/lib/org-sites/urls';

// The hero widget — Site Builder P3-B (Sep 9 2026). Extracted verbatim from
// SiteHomeBody so the published home, the preview and the editor canvas
// render it from one component. Props-only, server-safe (guardrail §4b).

export default function HeroSection({ site, w, spec }: { site: PublicSite; w: WidgetInstance; spec: TemplateSpec }) {
  const hero = parseHeroConfig(w.config);
  const heroImage = orgMediaUrl(site.id, hero.imagePath);
  const brandName = parseThemeTokens(site.theme_token_set).wordmark ?? site.orgName;
  return (
// The gradient rides the .org-scope accent vars (violet defaults; a
  // site's theme_token_set overrides via the layout's inline style).
  <section
    aria-label="Welcome"
    className={`relative overflow-hidden ${
      spec.hero === 'bleed'
        ? '-mx-4 px-6 py-14 sm:py-20 text-white'
        : 'rounded-xl px-6 py-10 text-white'
    }${heroImage ? ' min-h-[240px] sm:min-h-[320px] flex flex-col justify-end' : ''}`}
    style={{
      backgroundImage:
        'linear-gradient(to right, var(--org-accent), var(--org-accent-strong))',
    }}
  >
    {/* S1: the club's photo (a site asset through the tokenless
        streamer — /api/media/* is never optimizer-eligible, so
        unoptimized is mandatory) under a translucent accent wash
        that keeps the white text legible on any photo. */}
    {heroImage && (
      <>
        <Image
          src={heroImage}
          alt={hero.imageAlt ?? ''}
          fill
          unoptimized
          sizes="100vw"
          className="object-cover"
          priority
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to top, var(--org-accent-strong) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.15) 100%)',
          }}
        />
      </>
    )}
    <div className="relative">
      <h1
        className={
          spec.hero === 'bleed'
            ? 'text-3xl sm:text-5xl font-extrabold uppercase tracking-tight'
            : 'text-2xl sm:text-3xl font-bold'
        }
      >
        {hero.headline || brandName}
      </h1>
      <p className={spec.hero === 'bleed' ? 'mt-2 text-base opacity-90' : 'mt-1 text-sm opacity-90'}>
        {hero.tagline || (site.sportKey === 'golf' ? GOLF_TAGLINE : 'Schedules, standings, and teams — live.')}
      </p>
      {/* R5: the org's own description, written once at creation, finally
          reaches its public page. */}
      {site.orgDescription && (
        <p className="mt-3 max-w-2xl text-sm opacity-90 whitespace-pre-wrap">{site.orgDescription}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {hero.ctaLabel && hero.ctaUrl && (
          <a
            href={hero.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-md bg-white/95 px-4 py-2 text-sm font-semibold shadow-sm"
            style={{ color: 'var(--org-accent-strong)' }}
          >
            {hero.ctaLabel}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {/* Phase 9 V3 (leagues in program 11): the join door — the app's
            account-first join page (an absolute app URL: a custom
            domain must not swallow it). */}
        <a
          href={`${appBaseUrl()}/join/${site.side}/${site.orgId}`}
          className="inline-block rounded-md border border-white/80 px-4 py-2 text-sm font-semibold text-white"
          data-join-door="1"
        >
          {`Join ${brandName}`}
        </a>
      </div>
    </div>
  </section>
  );
}
