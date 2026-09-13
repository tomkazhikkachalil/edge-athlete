import { WIDGETS } from './catalog';
import { displayString, instanceDisplay } from './display';
import { GRID, type WidgetInstance } from './layout';

/**
 * Section height — Site Builder program 3, H1 (Sep 13 2026).
 *
 * `h` has always been a MINIMUM: the public grid's row tracks are
 * `minmax(row, auto)`, so a tall table grows its rows rather than
 * clipping. The editor canvas is the one place a tall body used to
 * overflow its tile (react-grid-layout needs a height per item) — H2
 * measures the content and shows the tile at `displayH`. The measured
 * height is NEVER persisted: content changes daily (a fixture, a post),
 * and persisting it would turn every content edit into a layout diff, an
 * undo step and an autosave, and silently raise the manager's floor.
 *
 * `display.height` — 'auto' (the default: fits content, exactly the old
 * render) or 'fixed' (the manager chose a deliberately small section: it
 * keeps `h` rows and SCROLLS INSIDE — CSS only on the public page, the
 * (public) contract — instead of clipping or forcing a taller card).
 * Pure; the canvas (H2) and the public renderer read the same rules.
 */

export type FitHeight = 'auto' | 'fixed';

/** One grid row plus its gap, in px — the height a tile gains per `h`. */
export const ROW_STEP = GRID.rowPx + GRID.gapPx;

/** The px a tile of `h` rows spans: h rows + (h − 1) gaps. */
export const rowsToPx = (h: number): number => Math.max(0, h) * GRID.rowPx + Math.max(0, h - 1) * GRID.gapPx;

/** The rows a tile needs so `contentPx` of body plus `chromePx` of frame
 *  (header, padding, borders) fits: ceil((content + chrome + gap) / step),
 *  never below 1. */
export const rowsForContent = (contentPx: number, chromePx: number): number =>
  Math.max(1, Math.ceil((Math.max(0, contentPx) + Math.max(0, chromePx) + GRID.gapPx) / ROW_STEP));

/** The instance's height rule — from its validated display settings. */
export const fitOf = (w: WidgetInstance): FitHeight => (displayString(instanceDisplay(w), 'height', 'auto') === 'fixed' ? 'fixed' : 'auto');

/** The height the CANVAS shows: a fixed tile keeps its stored `h`; an auto
 *  tile grows to its measured content (never below `h`); unmeasured = `h`. */
export const displayH = (w: WidgetInstance, need?: number): number => (fitOf(w) === 'fixed' || need === undefined ? w.h : Math.max(w.h, need));

/** The clamped `display.height` write on an instance (a render-only helper
 *  for the canvas's resize rule and the panel; the schema clamps the same). */
export function withFit(w: WidgetInstance, fit: FitHeight): WidgetInstance {
  const config = (w.config && typeof w.config === 'object' ? { ...(w.config as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const display = { ...((config.display && typeof config.display === 'object' ? config.display : {}) as Record<string, unknown>) };
  if (fit === 'auto') delete display.height;
  else display.height = 'fixed';
  if (Object.keys(display).length === 0) delete config.display;
  else config.display = display;
  return { ...w, config };
}

/**
 * The resize rule (H2's commit handler calls it): a gesture that kept the
 * displayed height changed only x / y / w — nothing to do. A new height
 * BELOW the content's need makes the tile fixed (the manager chose a small
 * section: it scrolls inside); a height at or above the need stores the
 * new minimum and an auto tile stays auto — while a FIXED tile dragged up
 * to its content goes back to auto (it no longer needs to scroll). The
 * stored `h` is always clamped to the catalog so the autosave validates.
 */
export function resolveResize(w: WidgetInstance, displayedH: number, newH: number, need?: number): { w: WidgetInstance; flipped: FitHeight | null } {
  if (newH === displayedH) return { w, flipped: null };
  const c = WIDGETS[w.key].constraints;
  const h = Math.min(c.maxH, Math.max(c.minH, Math.round(newH)));
  const fit = fitOf(w);
  const below = need !== undefined && h < need;
  if (below && fit === 'auto') return { w: withFit({ ...w, h }, 'fixed'), flipped: 'fixed' };
  if (!below && fit === 'fixed' && need !== undefined) return { w: withFit({ ...w, h }, 'auto'), flipped: 'auto' };
  return { w: { ...w, h }, flipped: null };
}
