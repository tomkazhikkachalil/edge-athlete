/**
 * What the PUBLIC page renders from a layout — Site Builder hardening H1
 * (Sep 9 2026). ONE function, server-only (it reaches the zod-backed
 * emptiness rule): the instances whose module is enabled, whose effective
 * audience is not staff, and that are not empty — compacted so the grid
 * closes ranks. `GridRenderer` calls this and nothing else; the canvas and
 * the picker render every instance on purpose (empties are affordances
 * there), so they do not.
 */

import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { effectiveAudience, moduleEnabled, type AudienceSite, type ModuleSite } from './audience';
import type { ContentSource } from './config';
import { isWidgetEmpty } from './emptiness';
import { compactLayout, type SiteLayout, type WidgetInstance } from './layout';

export type PublicViewSite = ContentSource & AudienceSite & ModuleSite;

export function publicWidgets(site: PublicViewSite, layout: SiteLayout, data: SiteHomeData): WidgetInstance[] {
  return compactLayout(
    layout.widgets.filter(w => moduleEnabled(site, w.key) && effectiveAudience(site, w) !== 'staff' && !isWidgetEmpty(w, data, site))
  );
}
