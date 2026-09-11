/**
 * The Sections list — Site Builder, Sep 11 2026. The phone editor and the
 * panel's Size control speak in NAMED sizes and reading order, not in grid
 * coordinates; these pure helpers translate. They produce layouts the same
 * `compactLayout` the canvas and the public renderer share, so a list edit is
 * a valid, compact layout every reader agrees on.
 *
 * - A size is a preset over `w` (no new field, no DDL): small 4 · medium 6 ·
 *   wide 12, offered only where the catalog's minW/maxW allow it.
 * - Reading order is the phone's order (`sortByPosition` after compaction —
 *   the same `deriveMobileOrder` the public page renders).
 * - `flowLayout` re-flows an ordered list into rows by width (a row closes
 *   when the next section would run past the grid), then compacts. A move
 *   or a resize normalises x positions below the change: a lone half tile a
 *   desktop manager right-aligned slides left. The SE handle stays freeform.
 * - The hero never moves and nothing moves above it.
 */
import { WIDGETS, type WidgetKey } from './catalog';
import { GRID, clampToConstraints, compactLayout, sortByPosition, type SiteLayout, type WidgetInstance } from './layout';

export const SIZE_PRESETS = { small: 4, medium: 6, wide: 12 } as const;
export type SizePreset = keyof typeof SIZE_PRESETS;
export const SIZE_ORDER: readonly SizePreset[] = ['small', 'medium', 'wide'];
export const SIZE_LABEL: Record<SizePreset, string> = { small: 'Small', medium: 'Medium', wide: 'Wide' };

/** The preset a width reads as: ≥9 wide, ≥5 medium, else small. */
export function sizePresetFor(w: number): SizePreset {
  return w >= 9 ? 'wide' : w >= 5 ? 'medium' : 'small';
}

/** The presets this widget may take, within the catalog's constraints. One
 *  option means the control has nothing to offer (the hero). */
export function sizeOptionsFor(key: WidgetKey): SizePreset[] {
  const c = WIDGETS[key].constraints;
  return SIZE_ORDER.filter(p => SIZE_PRESETS[p] >= c.minW && SIZE_PRESETS[p] <= c.maxW);
}

/** The order the phone renders — the list's rows. */
export function readingOrder(layout: SiteLayout): WidgetInstance[] {
  return sortByPosition(compactLayout(layout.widgets));
}

/** Rows by width in list order, then compaction. */
export function flowLayout(layout: SiteLayout, ordered: readonly WidgetInstance[]): SiteLayout {
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placed: WidgetInstance[] = [];
  for (const w of ordered) {
    if (x + w.w > GRID.cols) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    placed.push({ ...w, x, y });
    x += w.w;
    rowH = Math.max(rowH, w.h);
  }
  return { ...layout, widgets: compactLayout(placed) };
}

/** The layout with one section at a named size. The same object comes back
 *  when nothing changes (an unknown id, the size it already has, a preset the
 *  constraints clamp back to the current width) so `history.commit` no-ops. */
export function resizeToPreset(layout: SiteLayout, id: string, preset: SizePreset): SiteLayout {
  const target = layout.widgets.find(w => w.id === id);
  if (!target) return layout;
  const next = clampToConstraints({ ...target, w: SIZE_PRESETS[preset] });
  if (next.w === target.w) return layout;
  const ordered = readingOrder(layout).map(w => (w.id === id ? { ...w, w: next.w, x: 0 } : w));
  return flowLayout(layout, ordered);
}

export type MoveDirection = 'up' | 'down';

/** Whether a section may move one step in reading order: the hero never
 *  moves, nothing moves above the hero, the last section has no "down". */
export function canMove(layout: SiteLayout, id: string, dir: MoveDirection): boolean {
  const order = readingOrder(layout);
  const i = order.findIndex(w => w.id === id);
  if (i < 0 || order[i].key === 'hero') return false;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return false;
  return order[j].key !== 'hero';
}

/** Swap a section with its reading-order neighbour, then re-flow. */
export function moveInstance(layout: SiteLayout, id: string, dir: MoveDirection): SiteLayout {
  if (!canMove(layout, id, dir)) return layout;
  const order = readingOrder(layout);
  const i = order.findIndex(w => w.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  const swapped = [...order];
  [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
  return flowLayout(layout, swapped);
}
