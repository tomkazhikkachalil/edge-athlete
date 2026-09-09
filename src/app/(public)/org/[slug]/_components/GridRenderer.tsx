import type { CSSProperties } from 'react';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { effectiveSpec } from '@/lib/org-sites/theme';
import { WIDGETS } from '@/lib/site-builder/catalog';
import { compactLayout, deriveMobileOrder, type SiteLayout } from '@/lib/site-builder/layout';
import { isWidgetEmpty } from '@/lib/site-builder/emptiness';
import HeroSection from './HeroSection';
import WidgetBody, { widgetHeading, widgetTitle } from './WidgetBody';

// ── The public grid renderer — Site Builder P3-C (Sep 9 2026) ────────────────
// The composition on the 12-column grid, from the layout the site carries
// (its published revision's, else the template-aware projection of its
// module rows — seedLayout — so a site nobody has edited looks as it
// did). Rules, each structural:
//   • Empty widgets never render publicly (isWidgetEmpty); the grid re-
//     compacts around the holes they leave (compactLayout), so a visitor
//     never sees "No teams yet." or a gap where it would have been.
//   • `h` is a MINIMUM height: tracks are `minmax(row, auto)`, so a tall
//     table grows its rows rather than clipping.
//   • Mobile is DERIVED: the DOM is reading order (top to bottom, then left
//     to right — deriveMobileOrder), the phone is two columns with full/half
//     spans from the catalog, and ≥ 48rem the explicit placement takes over
//     through custom properties (`--sb-c/r/w/h`, 1-based ints). Tab order
//     and screen readers agree with the phone.
//   • Chrome is fixed: every tile keeps the section card, the heading and
//     the aria-label the specs match (`data-home-news`, `data-join-door`
//     ride inside the widgets); the sr-only h1 stays when there is no hero.
// Props-only, server-safe — the e2e hooks and the (public) contract hold.

const HERO_KEY = 'hero';

export default function GridRenderer({ site, layout, data }: { site: PublicSite; layout: SiteLayout; data: SiteHomeData }) {
  const spec = effectiveSpec(site);
  const compact = spec.density === 'compact';
  const sectionClass = `bg-surface rounded-lg shadow-sm border border-border ${compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'}`;
  const headingClass = compact ? 'text-sm font-semibold uppercase tracking-wide text-secondary' : 'text-lg font-semibold text-primary';

  // Public audience only; empty tiles drop; the grid closes ranks.
  const visible = compactLayout(layout.widgets.filter(w => w.visibility !== 'staff' && !isWidgetEmpty(w, data, site)));
  const ordered = deriveMobileOrder(visible);
  const hero = ordered.find(w => w.key === HERO_KEY);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* R5 a11y: the visible h1 lives in the hero — without one the outline
          must still open at level 1. */}
      {!hero && <h1 className="sr-only">{site.orgName}</h1>}
      <div className="sb-grid" data-sb-grid="">
        {ordered.map(w => {
          const style = { '--sb-c': w.x + 1, '--sb-r': w.y + 1, '--sb-w': w.w, '--sb-h': w.h } as CSSProperties;
          const half = WIDGETS[w.key].constraints.mobileSpan === 1 ? ' sb-half' : '';
          if (w.key === HERO_KEY) {
            return (
              <div key={w.id} className={`sb-w${half}`} style={style} data-widget={w.key} data-widget-id={w.id}>
                <HeroSection site={site} w={w} spec={spec} />
              </div>
            );
          }
          const title = widgetTitle(site, w);
          // Phase 6: a content widget heads itself only when its instance
          // sets a title; the aria-label always names the section.
          const heading = widgetHeading(site, w);
          return (
            <section key={w.id} aria-label={title} className={`sb-w${half} ${sectionClass}`} style={style} data-widget={w.key} data-widget-id={w.id}>
              {heading && <h2 className={headingClass}>{heading}</h2>}
              <WidgetBody site={site} w={w} data={data} spec={spec} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
