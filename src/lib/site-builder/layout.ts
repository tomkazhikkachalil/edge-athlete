/**
 * The site layout — Site Builder phase 1 (Sep 9 2026).
 *
 * A composition is JSON: an ordered list of widget INSTANCES placed on a
 * 12-column grid. Phase 1 stores none of this yet; `deriveLegacyLayout`
 * projects today's `org_site_modules` rows + `hero_config` + `contact_config`
 * into a linear, full-width layout so the public renderer can consume ONLY a
 * layout from now on. Phase 2 snapshots it into `org_site_revisions`;
 * phase 3 lets managers place widgets on the grid.
 *
 * Invariants decided up front (cheap now, expensive later):
 *  - `id` is an OPAQUE string, never the widget key — two standings tables
 *    must be legal JSON later. Legacy ids are deterministic (`legacy:<key>`).
 *  - `h` is a MINIMUM height (the renderer lets content grow a widget).
 *  - `cv` is the instance's config version, reserved for per-widget
 *    migrations; `normalizeLayout` is the single entry every reader calls.
 *  - `GRID` is the one source of the column count and the row/gap pixels
 *    the editor and the public CSS will both read.
 */

import { isMembersOnly } from '@/lib/org-sites/private';
import { WIDGETS, isWebWidgetKey, type SiteHomeDataKey, type WidgetKey } from './catalog';

export const GRID = { cols: 12, rowPx: 40, gapPx: 16 } as const;

export type WidgetVisibility = 'public' | 'members' | 'staff';

export interface WidgetInstance {
  id: string;
  key: WidgetKey;
  x: number;
  y: number;
  w: number;
  /** Minimum height in grid rows. */
  h: number;
  /** Config version (per-widget migrations run in normalizeLayout). */
  cv: number;
  config: unknown;
  visibility: WidgetVisibility;
}

export interface SiteLayout {
  version: 1;
  cols: 12;
  widgets: WidgetInstance[];
}

/** The rows a legacy site is derived from — structural, so node tests need
 *  no 40-field PublicSite fixture. */
export interface LegacySiteShape {
  modules: { module_key: string; enabled: boolean; sort_order: number; config: unknown }[];
  hero_config: unknown;
  contact_config: unknown;
  visibility: 'public' | 'private';
}

export const LEGACY_ID_PREFIX = 'legacy:';

/** Today's rows → a linear layout: enabled modules in sort_order, each a
 *  full-width row, hero and contact reading the site columns their console
 *  forms write to. A key the catalog does not know renders nothing (the one
 *  deliberate divergence from the pre-registry renderer, which titled a
 *  section with the raw key — unreachable on the current build because the
 *  DB CHECK mirrors MODULE_KEYS). */
export function deriveLegacyLayout(site: LegacySiteShape): SiteLayout {
  const ordered = site.modules
    .map((m, i) => ({ m, i }))
    // Stable sort: ties keep the incoming (DB) order, exactly today's behaviour.
    .sort((a, b) => a.m.sort_order - b.m.sort_order || a.i - b.i)
    .map(({ m }) => m)
    .filter(m => m.enabled && isWebWidgetKey(m.module_key));

  const widgets: WidgetInstance[] = ordered.map((m, index) => {
    const key = m.module_key as WidgetKey;
    const config = key === 'hero' ? site.hero_config : key === 'contact' ? site.contact_config : m.config;
    return {
      id: `${LEGACY_ID_PREFIX}${key}`,
      key,
      x: 0,
      y: index,
      w: GRID.cols,
      h: WIDGETS[key].constraints.defaultSize.h,
      cv: 1,
      config: config ?? {},
      visibility: isMembersOnly(site, key) ? 'members' : 'public',
    };
  });
  return { version: 1, cols: GRID.cols, widgets };
}

/** The single entry every reader calls: envelope + per-widget config
 *  migrations. Identity in phase 1 (nothing has a second version yet). */
export function normalizeLayout(layout: SiteLayout): SiteLayout {
  return layout;
}

export function hasWidget(layout: SiteLayout, key: WidgetKey): boolean {
  return layout.widgets.some(w => w.key === key);
}

/** The FIRST instance of a key (phase 1 layouts hold at most one). */
export function widget(layout: SiteLayout, key: WidgetKey): WidgetInstance | undefined {
  return layout.widgets.find(w => w.key === key);
}

/** Does any widget on this layout consume the given home-data field? The
 *  public home gates each reader on this so an absent widget costs no query. */
export function needsData(layout: SiteLayout, field: SiteHomeDataKey): boolean {
  return layout.widgets.some(w => WIDGETS[w.key].data.includes(field));
}
