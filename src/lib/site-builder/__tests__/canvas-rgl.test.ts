import { describe, expect, it } from 'vitest';
import { WIDGETS } from '../catalog';
import { applyRglPositions, commitGesture, toRglItems } from '../canvas-rgl';
import { fitOf, withFit } from '../fit';
import { place } from '../seeds';

// Program 3, H2 — the canvas ↔ react-grid-layout translation. The pins:
// the grid shows the DISPLAY height, a commit never copies it back, and
// only a gesture that changed the height touches the stored `h`.

const layout = () => ({ version: 1 as const, cols: 12 as const, widgets: [place('hero', 0, 0, { h: 4 }, { id: 'hero' }), place('teams', 0, 4, { w: 6, h: 3 }, { id: 't' }), place('staff', 6, 4, { w: 6, h: 3 }, { id: 's' })] });

describe('toRglItems', () => {
  it('shows an auto tile at its measured content (never below h), a fixed one at h; maxH rises to the need for auto tiles', () => {
    const l = layout();
    const items = toRglItems(l, { t: 7, s: 2 });
    const t = items.find(i => i.i === 't')!;
    const s = items.find(i => i.i === 's')!;
    expect(t.h).toBe(7);
    expect(t.maxH).toBe(Math.max(WIDGETS.teams.constraints.maxH, 7));
    expect(s.h).toBe(3);
    expect(items.find(i => i.i === 'hero')!.h).toBe(4);
    const fixed = { ...l, widgets: l.widgets.map(w => (w.id === 't' ? withFit(w, 'fixed') : w)) };
    const ft = toRglItems(fixed, { t: 7 }).find(i => i.i === 't')!;
    expect(ft.h).toBe(3);
    expect(ft.maxH).toBe(WIDGETS.teams.constraints.maxH);
  });
});

describe('applyRglPositions / commitGesture', () => {
  it('copies x / y / w back, never the item h; re-compacts under the stored heights', () => {
    const l = layout();
    const items = toRglItems(l, { t: 7 }).map(i => (i.i === 's' ? { ...i, x: 0, y: 11 } : i));
    const next = applyRglPositions(l, items);
    expect(next.widgets.find(w => w.id === 't')!.h).toBe(3); // the display 7 never lands
    expect(next.widgets.find(w => w.id === 's')!.x).toBe(0);
    // compacted under the STORED heights: staff sits right under teams (y 4 + h 3 = 7), not at 11
    expect(next.widgets.find(w => w.id === 's')!.y).toBe(7);
  });

  it('a drag (no height change) commits positions only; nothing changed → null', () => {
    const l = layout();
    const items = toRglItems(l, { t: 7 });
    expect(commitGesture(l, items, { id: 't', oldH: 7, newH: 7 }, { t: 7 })).toBeNull();
    const moved = items.map(i => (i.i === 's' ? { ...i, x: 0, y: 20 } : i));
    const r = commitGesture(l, moved, { id: 's', oldH: 3, newH: 3 }, { t: 7 })!;
    expect(r.flipped).toBeNull();
    expect(r.layout.widgets.find(w => w.id === 't')!.h).toBe(3);
  });

  it('a resize below the content flips the tile to fixed at the new height (the toast\'s signal); above stores the minimum', () => {
    const l = layout();
    const items = toRglItems(l, { t: 7 });
    const down = commitGesture(l, items.map(i => (i.i === 't' ? { ...i, h: 4 } : i)), { id: 't', oldH: 7, newH: 4 }, { t: 7 })!;
    expect(down.flipped).toBe('fixed');
    const t = down.layout.widgets.find(w => w.id === 't')!;
    expect(t.h).toBe(4);
    expect(fitOf(t)).toBe('fixed');
    const up = commitGesture(l, items.map(i => (i.i === 't' ? { ...i, h: 9 } : i)), { id: 't', oldH: 7, newH: 9 }, { t: 7 })!;
    expect(up.flipped).toBeNull();
    expect(up.layout.widgets.find(w => w.id === 't')!.h).toBe(9);
    expect(fitOf(up.layout.widgets.find(w => w.id === 't')!)).toBe('auto');
  });
});
