import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { widget, type SiteLayout } from '@/lib/site-builder/layout';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { FULL_WIDTH_MODULES, templateSpec } from '@/lib/org-sites/templates';
import HeroSection from './HeroSection';
import WidgetBody from './WidgetBody';

// The site home's module rendering, extracted (cleanup round) so the
// PUBLISHED home page and the token-gated draft PREVIEW render the exact
// same markup from different data paths (cached vs raw). Props-only,
// server-safe — the public-segment component contract. The data bag's type
// lives in @/lib/org-sites/home-data (P3-A) — shared with the resolver.
//
// Site Builder P3-B: the hero and each section's body are their own
// props-only components (HeroSection, WidgetBody) so the editor CANVAS
// renders a widget from the same code. This file is the FRAME: the linear
// order, the section chrome and the heading. Phase 3's grid renderer
// replaces the frame, not the widgets.

export type { SiteHomeData };

export default function SiteHomeBody({
  site,
  layout,
  data,
}: {
  site: PublicSite;
  /** P1-C: the composition this page renders — today derived from the
   *  module rows (deriveLegacyLayout), later a stored revision. `site`
   *  remains for chrome-level values (name, template, theme, urls, id). */
  layout: SiteLayout;
  data: SiteHomeData;
}) {
  const heroWidget = widget(layout, 'hero');
  // B1: label overrides (the section headings, never <title>).
  const nav = parseNavConfig(site.nav_config);
  // B2: the template's render decisions (classic = the shipped markup).
  const spec = templateSpec(site.template_id);
  const compact = spec.density === 'compact';
  const sectionClass = `bg-surface rounded-lg shadow-sm border border-border ${
    compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'
  }`;
  const headingClass = compact
    ? 'text-sm font-semibold uppercase tracking-wide text-secondary'
    : 'text-lg font-semibold text-primary';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* R5 a11y: the visible h1 lives in the hero — a hero-disabled site
          (DB-level state; the console can't toggle hero) must still open
          its outline at level 1. */}
      {!heroWidget && <h1 className="sr-only">{site.orgName}</h1>}
      {heroWidget && <HeroSection site={site} w={heroWidget} spec={spec} />}
      <div className={spec.sections === 'grid' ? 'grid gap-6 sm:grid-cols-2' : 'space-y-6'}>
        {/* P1-C: the layout's widgets in order (a linear projection today;
            FULL_WIDTH_MODULES stays the span source until phase 3 reads w.w). */}
        {layout.widgets
          .filter(w => w.key !== 'hero')
          .map(w => (
            <section
              key={w.key}
              aria-label={moduleLabel(w.key, nav, site.side, site.sportKey)}
              className={`${sectionClass} ${
                spec.sections === 'grid' && FULL_WIDTH_MODULES.has(w.key) ? 'sm:col-span-2' : ''
              }`}
            >
              <h2 className={headingClass}>{moduleLabel(w.key, nav, site.side, site.sportKey)}</h2>
              <WidgetBody site={site} w={w} data={data} spec={spec} />
            </section>
          ))}
      </div>
    </div>
  );
}
