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
import { FULL_WIDTH_MODULES, templateSpec } from '@/lib/org-sites/templates';
import { WIDGETS, isWebWidgetKey, type SiteHomeDataKey, type WidgetKey } from './catalog';

export const GRID = { cols: 12, rowPx: 40, gapPx: 24 } as const;

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
 *  full-width row stacked by height, hero and contact reading the site
 *  columns their console forms write to. A key the catalog does not know renders nothing (the one
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

  // Stacked by cumulative height (each widget starts where the previous
  // ends) so the projection is a VALID grid — tiles never overlap — and
  // compaction is a no-op on it. Order is what matters; the rows follow.
  let nextY = 0;
  const widgets: WidgetInstance[] = ordered.map(m => {
    const key = m.module_key as WidgetKey;
    const config = key === 'hero' ? site.hero_config : key === 'contact' ? site.contact_config : m.config;
    const h = WIDGETS[key].constraints.defaultSize.h;
    const y = nextY;
    nextY += h;
    return {
      id: `${LEGACY_ID_PREFIX}${key}`,
      key,
      x: 0,
      y,
      w: GRID.cols,
      h,
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

// ── Grid geometry (P3-B) ─────────────────────────────────────────────────────
// Pure, shared by the editor (react-grid-layout's compaction is the same
// algorithm) and the public renderer (which re-compacts after dropping
// empty widgets). `h` stays a MINIMUM height throughout.

type Box = Pick<WidgetInstance, 'x' | 'y' | 'w' | 'h'>;

export function collides(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Reading order: top to bottom, then left to right. */
export function sortByPosition<T extends Box>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Vertical compaction: in reading order, each widget floats up until it
 *  would overlap one already placed. Idempotent; never overlaps. */
export function compactLayout(widgets: readonly WidgetInstance[]): WidgetInstance[] {
  const placed: WidgetInstance[] = [];
  for (const w of sortByPosition(widgets)) {
    let y = w.y;
    // Float up while nothing placed collides at the row above.
    while (y > 0 && !placed.some(p => collides({ ...w, y: y - 1 }, p))) y--;
    // Push down past anything we still overlap (out-of-order input).
    while (placed.some(p => collides({ ...w, y }, p))) y++;
    placed.push({ ...w, y });
  }
  return placed;
}

export interface LayoutIssue {
  id: string;
  message: string;
}

/** What a schema cannot say: bounds against the grid, per-widget size
 *  constraints, and overlaps. Empty = valid. */
export function validateLayout(layout: SiteLayout): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  for (const w of layout.widgets) {
    const c = WIDGETS[w.key].constraints;
    if (w.x < 0 || w.x + w.w > GRID.cols) issues.push({ id: w.id, message: `${w.key} runs past the grid` });
    if (w.w < c.minW || w.w > c.maxW) issues.push({ id: w.id, message: `${w.key} must be ${c.minW}–${c.maxW} columns wide` });
    if (w.h < c.minH || w.h > c.maxH) issues.push({ id: w.id, message: `${w.key} must be ${c.minH}–${c.maxH} rows tall` });
  }
  for (let i = 0; i < layout.widgets.length; i++) {
    for (let j = i + 1; j < layout.widgets.length; j++) {
      const a = layout.widgets[i];
      const b = layout.widgets[j];
      if (collides(a, b)) issues.push({ id: b.id, message: `${b.key} overlaps ${a.key}` });
    }
  }
  return issues;
}

/** A client-safe opaque id: `crypto.getRandomValues` (Safari 11+), never
 *  `randomUUID` (Safari 15.4+, above the iOS 15 floor). */
export function newInstanceId(random: (bytes: Uint8Array) => Uint8Array = defaultRandom): string {
  const bytes = random(new Uint8Array(8));
  let out = 'w_';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function defaultRandom(bytes: Uint8Array): Uint8Array {
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

// ── The projection of the module rows onto the grid (P3-C) ──────────────────

/** Reading order for the phone: top to bottom, then left to right. The DOM
 *  order of the public grid — so tab order and screen readers agree with
 *  what the phone shows. */
export function deriveMobileOrder(widgets: readonly WidgetInstance[]): WidgetInstance[] {
  return sortByPosition(widgets);
}

/** A site with no stored layout renders the projection of its module rows
 *  onto the grid, TEMPLATE-AWARE so the flip from the linear frame to the
 *  grid is a visual no-op: `classic` stacks every section full width;
 *  `bold` (a two-column section grid at ≥ sm) pairs half-width sections
 *  and lets the full-width modules (teams, news, gallery, courses, leaders)
 *  span both — the same placement CSS auto-flow gave. `h` stays each
 *  widget's default (a MINIMUM height). */
export function layoutFromModules(site: LegacySiteShape & { template_id: string }): SiteLayout {
  const linear = deriveLegacyLayout(site);
  if (templateSpec(site.template_id).sections !== 'grid') return linear;
  // Halves alternate left/right; a full-width widget starts a new row. The
  // linear y (cumulative heights) keeps everything non-overlapping; the
  // compaction then lifts each right-hand half up beside its left partner.
  let col = 0;
  const widgets = linear.widgets.map(w => {
    if (w.key === 'hero' || FULL_WIDTH_MODULES.has(w.key)) {
      col = 0;
      return { ...w, x: 0, w: GRID.cols };
    }
    const placed = { ...w, x: col * 6, w: 6 };
    col = col === 0 ? 1 : 0;
    return placed;
  });
  return { ...linear, widgets: compactLayout(widgets) };
}

// ── Adding a widget (P3-D) ──────────────────────────────────────────────────

/** A fresh instance of a web widget for THIS site: default size, config
 *  sourced the way deriveLegacyLayout sources it (hero → hero_config,
 *  contact → contact_config, else the module row's config), visibility from
 *  the org's members-only policy. `id` is minted by the caller
 *  (newInstanceId) so tests can pass a fixed one. */
export function newInstanceFor(site: LegacySiteShape, key: WidgetKey, id: string): WidgetInstance {
  const row = site.modules.find(m => m.module_key === key);
  const config = key === 'hero' ? site.hero_config : key === 'contact' ? site.contact_config : row?.config;
  const c = WIDGETS[key].constraints;
  return {
    id,
    key,
    x: 0,
    y: 0,
    w: c.defaultSize.w,
    h: c.defaultSize.h,
    cv: 1,
    config: config ?? {},
    visibility: isMembersOnly(site, key) ? 'members' : 'public',
  };
}

/** The layout's bottom edge — the row a new widget starts on. */
export function layoutBottom(widgets: readonly WidgetInstance[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

/** Append a widget below everything else (left-aligned), then compact so
 *  a half-width newcomer slides up beside a half-width row end. */
export function appendWidget(layout: SiteLayout, instance: WidgetInstance): SiteLayout {
  const placed = { ...instance, x: 0, y: layoutBottom(layout.widgets) };
  return { ...layout, widgets: compactLayout([...layout.widgets, placed]) };
}

/** The layout without one instance, compacted. */
export function removeWidget(layout: SiteLayout, id: string): SiteLayout {
  return { ...layout, widgets: compactLayout(layout.widgets.filter(w => w.id !== id)) };
}
