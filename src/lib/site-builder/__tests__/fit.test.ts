import { describe, expect, it } from 'vitest';
import { WIDGETS } from '../catalog';
import { ROW_STEP, displayH, fitOf, resolveResize, rowsForContent, rowsToPx, withFit } from '../fit';
import { GRID } from '../layout';
import { place } from '../seeds';

// Program 3, H1 — the fit rule. `h` is the manager's MINIMUM; the canvas
// shows an auto tile at its content's height and never persists it; a
// resize below the content flips the tile to fixed (it scrolls inside).

describe('px ↔ rows', () => {
  it('a row plus its gap is the step; h rows span h rows and h − 1 gaps', () => {
    expect(ROW_STEP).toBe(GRID.rowPx + GRID.gapPx);
    expect(rowsToPx(1)).toBe(GRID.rowPx);
    expect(rowsToPx(3)).toBe(3 * GRID.rowPx + 2 * GRID.gapPx);
    expect(rowsToPx(0)).toBe(0);
  });
  it('rowsForContent rounds up, counts the chrome, and never answers below one', () => {
    expect(rowsForContent(0, 0)).toBe(1);
    // 3 rows = 3 steps = 192px of content + chrome + the counted gap: 138 + 30 + 24 fits…
    expect(rowsForContent(138, 30)).toBe(3);
    // …one more px needs a fourth.
    expect(rowsForContent(139, 30)).toBe(4);
    expect(rowsForContent(170, 67)).toBe(5);
    expect(rowsForContent(-5, -5)).toBe(1);
  });
});

describe('fitOf / displayH / withFit', () => {
  it('auto by default; fixed only from a valid display; a content-shaped display never counts', () => {
    expect(fitOf(place('teams', 0, 0))).toBe('auto');
    expect(fitOf(place('teams', 0, 0, undefined, { config: { display: { height: 'fixed' } } }))).toBe('fixed');
    expect(fitOf(place('teams', 0, 0, undefined, { config: { display: { height: 'tall' } } }))).toBe('auto');
    expect(fitOf(place('hero', 0, 0, undefined, { config: { display: { height: 'fixed' } } }))).toBe('auto'); // the hero declares no height
  });
  it('displayH: an auto tile grows to its measured need, never below h; a fixed tile keeps h; unmeasured = h', () => {
    const w = place('teams', 0, 0, { h: 3 });
    expect(displayH(w)).toBe(3);
    expect(displayH(w, 2)).toBe(3);
    expect(displayH(w, 7)).toBe(7);
    expect(displayH(withFit(w, 'fixed'), 7)).toBe(3);
  });
  it('withFit writes and clears the key without touching the rest, and drops an empty display', () => {
    const w = place('teams', 0, 0, undefined, { config: { title: 'Squads', display: { variant: 'tiles' } } });
    const fixed = withFit(w, 'fixed');
    expect(fixed.config).toEqual({ title: 'Squads', display: { variant: 'tiles', height: 'fixed' } });
    expect(withFit(fixed, 'auto').config).toEqual({ title: 'Squads', display: { variant: 'tiles' } });
    expect(withFit(withFit(place('teams', 0, 0), 'fixed'), 'auto').config).toEqual({});
    expect(w.config).toEqual({ title: 'Squads', display: { variant: 'tiles' } }); // untouched
  });
});

describe('resolveResize — the commit rule', () => {
  const w = place('teams', 0, 0, { h: 3 });
  it('a gesture that kept the displayed height is not a resize (the same object comes back)', () => {
    expect(resolveResize(w, 6, 6, 6)).toEqual({ w, flipped: null });
    expect(resolveResize(w, 6, 6, 6).w).toBe(w);
  });
  it('below the content on an auto tile → fixed at the new height', () => {
    const r = resolveResize(w, 6, 4, 6);
    expect(r.flipped).toBe('fixed');
    expect(r.w.h).toBe(4);
    expect(fitOf(r.w)).toBe('fixed');
  });
  it('at or above the content → the new minimum, still auto; unmeasured → the new minimum', () => {
    expect(resolveResize(w, 3, 8, 6)).toEqual({ w: { ...w, h: 8 }, flipped: null });
    expect(resolveResize(w, 3, 5)).toEqual({ w: { ...w, h: 5 }, flipped: null });
  });
  it('a fixed tile dragged up to its content goes back to auto', () => {
    const fixed = withFit({ ...w, h: 2 }, 'fixed');
    const r = resolveResize(fixed, 2, 6, 6);
    expect(r.flipped).toBe('auto');
    expect(fitOf(r.w)).toBe('auto');
    expect(r.w.h).toBe(6);
    // …but a fixed tile made smaller stays fixed, quietly.
    expect(resolveResize(fixed, 2, 1, 6).flipped).toBeNull();
    expect(fitOf(resolveResize(fixed, 2, 1, 6).w)).toBe('fixed');
  });
  it('the stored h is clamped to the catalog (the autosave validates) and rounded', () => {
    const c = WIDGETS.teams.constraints;
    expect(resolveResize(w, 3, c.maxH + 10, 40).w.h).toBe(c.maxH);
    expect(resolveResize(w, 3, 0, 6).w.h).toBe(c.minH);
    expect(resolveResize(w, 3, 4.6).w.h).toBe(5);
  });
});
