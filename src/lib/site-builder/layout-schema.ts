/**
 * The layout envelope's wire schema — Site Builder P3-B (Sep 9 2026).
 *
 * What the editor PUTs to the draft and what the canvas reads back. Zod
 * validates shape and bounds; `validateLayout` (layout.ts, pure) then checks
 * what a schema cannot: overlaps and per-widget size constraints. Both run
 * server-side on every write; the editor runs the same code before it saves.
 * SERVER / EDITOR ONLY — imports zod (the catalog stays import-free).
 */

import { z } from 'zod';
import { WEB_WIDGET_KEYS, isWebWidgetKey } from './catalog';
import { GRID, type SiteLayout } from './layout';

export const INSTANCE_ID_MAX = 64;
export const LAYOUT_WIDGETS_MAX = 60;

export const WidgetInstanceSchema = z.object({
  id: z.string().trim().min(1).max(INSTANCE_ID_MAX),
  key: z.enum(WEB_WIDGET_KEYS),
  x: z.number().int().min(0).max(GRID.cols - 1),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(GRID.cols),
  h: z.number().int().min(1).max(200),
  cv: z.number().int().min(1).max(1000),
  config: z.record(z.string(), z.unknown()).default({}),
  visibility: z.enum(['public', 'members', 'staff']).default('public'),
});

export const LayoutSchema = z
  .object({
    version: z.literal(1),
    cols: z.literal(GRID.cols),
    widgets: z.array(WidgetInstanceSchema).max(LAYOUT_WIDGETS_MAX),
  })
  .refine(l => new Set(l.widgets.map(w => w.id)).size === l.widgets.length, 'Widget ids must be unique')
  .refine(l => l.widgets.every(w => w.x + w.w <= GRID.cols), 'A widget runs past the grid');

/** Defensive: a stored layout from any build, or null when unusable (the
 *  caller then derives one from the module rows). Never throws. */
export function parseStoredLayout(raw: unknown): SiteLayout | null {
  const result = LayoutSchema.safeParse(raw);
  if (!result.success) return null;
  // The enum already guarantees web keys; the guard keeps the type honest.
  if (!result.data.widgets.every(w => isWebWidgetKey(w.key))) return null;
  return result.data as SiteLayout;
}
