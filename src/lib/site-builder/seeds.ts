/**
 * Template seeds — Site Builder phase 8 (Sep 9 2026).
 *
 * A seed is the layout a site has before anyone arranges it: the template's
 * PLACEMENT of the org's enabled modules in the side-and-sport order the
 * module rows already carry (`defaultModuleOrder` at creation, `set_nav`
 * after). The plan's four seeds (club-golf, league-golf, club-team,
 * league-team) collapse into that: ORDER is the side × sport's (validate.ts),
 * PAIRING is the template's — `classic` stacks every section full width,
 * `bold` pairs half-width sections and lets the full-width modules span —
 * so the seed of an untouched site is exactly what the module rows
 * projected before (the P3-C flip stays a visual no-op) and nothing about
 * a published page changes here.
 *
 * Three uses:
 *  • the public home and the preview render `seedLayout(site)` when a site
 *    has no stored layout (it replaces `layoutFromModules`);
 *  • `set_template` on a site WITH a stored layout re-lays it with
 *    `applySeed`: every instance the seed knows takes the seed's place and
 *    size, everything else (content tiles, a second standings) follows in
 *    reading order — a template switch never loses a tile or a title;
 *  • the checklist asks "arranged?" by comparing against the seed.
 *
 * `place()` is the seed author's primitive: a widget at a cell, default
 * size unless told, options empty (content is the org's — phase 5).
 */

import { FULL_WIDTH_MODULES, templateSpec } from '@/lib/org-sites/templates';
import { WIDGETS, type WidgetKey } from './catalog';
import {
  GRID,
  compactLayout,
  deriveLegacyLayout,
  layoutBottom,
  sortByPosition,
  type LegacySiteShape,
  type SiteLayout,
  type WidgetInstance,
} from './layout';

export const SEED_ID_PREFIX = 'seed:';

/** A widget at (x, y), the catalog's default size unless given. */
export function place(
  key: WidgetKey,
  x: number,
  y: number,
  size?: { w?: number; h?: number },
  opts?: { id?: string; visibility?: WidgetInstance['visibility']; config?: Record<string, unknown> }
): WidgetInstance {
  const c = WIDGETS[key].constraints;
  return {
    id: opts?.id ?? `${SEED_ID_PREFIX}${key}`,
    key,
    x,
    y,
    w: size?.w ?? c.defaultSize.w,
    h: size?.h ?? c.defaultSize.h,
    cv: 1,
    config: opts?.config ?? {},
    visibility: opts?.visibility ?? 'public',
  };
}

/** The seed of a site: its enabled modules, in their order, placed the
 *  way its template pairs them. Ids are the legacy ids (`legacy:<key>`) so
 *  a stored layout that grew out of the projection keeps them. */
export function seedLayout(site: LegacySiteShape & { template_id: string }): SiteLayout {
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

/** Re-lay an existing layout with a seed: the FIRST instance of each key
 *  the seed places takes the seed's cell and size (its id, options and
 *  visibility untouched); every other instance — content tiles, a second
 *  table, a widget the seed does not know — follows below, full width in
 *  its reading order. Compacted, so the result is a valid layout. */
export function applySeed(layout: SiteLayout, seed: SiteLayout): SiteLayout {
  const seedByKey = new Map<string, WidgetInstance>();
  for (const s of seed.widgets) if (!seedByKey.has(s.key)) seedByKey.set(s.key, s);
  const placed: WidgetInstance[] = [];
  const rest: WidgetInstance[] = [];
  const taken = new Set<string>();
  for (const w of sortByPosition(layout.widgets)) {
    const s = seedByKey.get(w.key);
    if (s && !taken.has(w.key)) {
      taken.add(w.key);
      placed.push({ ...w, x: s.x, y: s.y, w: s.w, h: Math.max(s.h, WIDGETS[w.key].constraints.minH) });
    } else {
      rest.push(w);
    }
  }
  let y = layoutBottom(placed);
  const appended = rest.map(w => {
    const c = WIDGETS[w.key].constraints;
    const width = Math.min(GRID.cols, Math.max(c.minW, w.w));
    const out = { ...w, x: 0, y, w: width };
    y += w.h;
    return out;
  });
  return { ...layout, widgets: compactLayout([...placed, ...appended]) };
}

/** Has the manager arranged anything, or is this still the seed? Compares
 *  placement only (ids, options and visibility aside). */
export function isSeedLayout(layout: SiteLayout, seed: SiteLayout): boolean {
  const cells = (l: SiteLayout) =>
    sortByPosition(l.widgets)
      .map(w => `${w.key}@${w.x},${w.y},${w.w},${w.h}`)
      .join('|');
  return cells(layout) === cells(seed);
}
