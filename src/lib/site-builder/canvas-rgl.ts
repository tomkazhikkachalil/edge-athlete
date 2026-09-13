import { WIDGETS } from './catalog';
import { displayH, fitOf, resolveResize, type FitHeight } from './fit';
import { compactLayout, type SiteLayout, type WidgetInstance } from './layout';

/**
 * The canvas ↔ react-grid-layout translation — Site Builder program 3, H2
 * (Sep 13 2026). Pure, so the rules the canvas lives by are unit-tested:
 *
 *  • The grid shows each tile at its DISPLAY height — `displayH`: an auto
 *    tile grows to its measured content (never below its stored `h`), a
 *    fixed tile keeps `h`. `maxH` on an auto tile rises to the measured
 *    need so the resize handle can reach the content's height (the STORED
 *    `h` is still clamped to the catalog by `resolveResize`).
 *  • A commit copies x / y / w back — NEVER the item's h, which is the
 *    display height; the stored `h` changes only through `resolveResize`,
 *    when the gesture itself changed the height (`oldItem.h !== newItem.h`).
 *    So the measured height never reaches the layout, the autosave or the
 *    undo stack.
 */

export interface RglItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

/** Measured content, in rows, per instance id (absent = not yet measured). */
export type MeasuredRows = Readonly<Record<string, number>>;

export function toRglItems(layout: SiteLayout, measured: MeasuredRows): RglItem[] {
  return layout.widgets.map(w => {
    const c = WIDGETS[w.key].constraints;
    const need = measured[w.id];
    return {
      i: w.id,
      x: w.x,
      y: w.y,
      w: w.w,
      h: displayH(w, need),
      minW: c.minW,
      maxW: c.maxW,
      minH: c.minH,
      maxH: fitOf(w) === 'fixed' ? c.maxH : Math.max(c.maxH, need ?? 0),
    };
  });
}

/** The layout after a gesture: positions and widths from the grid, the
 *  stored heights kept, the whole re-compacted under the STORED heights. */
export function applyRglPositions(layout: SiteLayout, items: readonly Pick<RglItem, 'i' | 'x' | 'y' | 'w'>[]): SiteLayout {
  const byId = new Map(items.map(i => [i.i, i]));
  const widgets: WidgetInstance[] = layout.widgets.map(w => {
    const i = byId.get(w.id);
    return i ? { ...w, x: i.x, y: i.y, w: i.w } : w;
  });
  return { ...layout, widgets: compactLayout(widgets) };
}

/** One gesture, one commit: positions applied; if THIS item's height
 *  changed, the fit rule decides the stored `h` and whether the tile
 *  flipped. `null` when nothing changed. */
export function commitGesture(
  layout: SiteLayout,
  items: readonly Pick<RglItem, 'i' | 'x' | 'y' | 'w'>[],
  gesture: { id: string; oldH: number; newH: number } | null,
  measured: MeasuredRows
): { layout: SiteLayout; flipped: FitHeight | null } | null {
  let next = applyRglPositions(layout, items);
  let flipped: FitHeight | null = null;
  if (gesture && gesture.oldH !== gesture.newH) {
    const w = next.widgets.find(x => x.id === gesture.id);
    if (w) {
      const r = resolveResize(w, gesture.oldH, gesture.newH, measured[gesture.id]);
      flipped = r.flipped;
      next = { ...next, widgets: compactLayout(next.widgets.map(x => (x.id === gesture.id ? r.w : x))) };
    }
  }
  return JSON.stringify(next.widgets) === JSON.stringify(layout.widgets) ? null : { layout: next, flipped };
}
