import { describe, expect, it } from 'vitest';
import { parseStoredLayout } from '../layout-schema';
import { deriveMobileOrder, validateLayout, type SiteLayout, type WidgetInstance } from '../layout';
import { canMove, flowLayout, moveInstance, readingOrder, resizeToPreset, sizeOptionsFor, sizePresetFor, SIZE_PRESETS } from '../sections';

// The Sections list's semantics (Sep 11 2026): a list edit is a valid, compact
// layout that reads — on the phone and on the canvas — the way the list says.

const w = (id: string, key: WidgetInstance['key'], x: number, y: number, width: number, h: number): WidgetInstance => ({ id, key, x, y, w: width, h, cv: 1, config: {}, visibility: 'public' });
const L = (...widgets: WidgetInstance[]): SiteLayout => ({ version: 1, cols: 12, widgets });
const ids = (l: SiteLayout) => readingOrder(l).map(x => x.id);
const at = (l: SiteLayout, id: string) => l.widgets.find(x => x.id === id)!;
const sound = (l: SiteLayout) => {
  expect(validateLayout(l)).toEqual([]);
  expect(parseStoredLayout(l)).not.toBeNull();
  expect(deriveMobileOrder(l.widgets).map(x => x.id)).toEqual(ids(l));
};
const hero = w('hero', 'hero', 0, 0, 12, 3);

describe('sizes', () => {
  it('a width reads as a preset; options follow the catalog constraints', () => {
    expect([4, 3, 5, 6, 8, 9, 12].map(sizePresetFor)).toEqual(['small', 'small', 'medium', 'medium', 'medium', 'wide', 'wide']);
    expect(sizeOptionsFor('hero')).toEqual(['wide']);
    expect(sizeOptionsFor('standings')).toEqual(['medium', 'wide']); // TABLE 6–12
    expect(sizeOptionsFor('news')).toEqual(['medium', 'wide']); // FULL 6–12
    expect(sizeOptionsFor('embed')).toEqual(['medium', 'wide']);
    expect(sizeOptionsFor('contact')).toEqual(['small', 'medium', 'wide']); // HALF 4–12
    expect(sizeOptionsFor('text')).toEqual(['small', 'medium', 'wide']);
    expect(sizeOptionsFor('image')).toEqual(['small', 'medium', 'wide']);
    expect(SIZE_PRESETS).toEqual({ small: 4, medium: 6, wide: 12 });
  });
});

describe('moveInstance', () => {
  it('a full stack A,B,C: C up → A,C,B; every result is valid and compact', () => {
    const l = L(hero, w('A', 'news', 0, 3, 12, 4), w('B', 'staff', 0, 7, 12, 3), w('C', 'contact', 0, 10, 12, 3));
    const next = moveInstance(l, 'C', 'up');
    expect(ids(next)).toEqual(['hero', 'A', 'C', 'B']);
    expect(at(next, 'C').y).toBe(7);
    expect(at(next, 'B').y).toBe(10);
    sound(next);
  });
  it('a half pair [A6 B6] then C12: B up → B left, A right; C up over the pair → A,C,B and B falls', () => {
    const l = L(hero, w('A', 'standings', 0, 3, 6, 4), w('B', 'schedule', 6, 3, 6, 4), w('C', 'news', 0, 7, 12, 4));
    const bUp = moveInstance(l, 'B', 'up');
    expect(ids(bUp)).toEqual(['hero', 'B', 'A', 'C']);
    expect(at(bUp, 'B')).toMatchObject({ x: 0, y: 3 });
    expect(at(bUp, 'A')).toMatchObject({ x: 6, y: 3 });
    sound(bUp);
    const cUp = moveInstance(l, 'C', 'up');
    expect(ids(cUp)).toEqual(['hero', 'A', 'C', 'B']);
    expect(at(cUp, 'C')).toMatchObject({ x: 0, y: 7, w: 12 });
    expect(at(cUp, 'B')).toMatchObject({ x: 0, y: 11 });
    sound(cUp);
  });
  it('the hero never moves and nothing moves above it; the last has no down; unknown ids are no-ops (same object)', () => {
    const l = L(hero, w('A', 'news', 0, 3, 12, 4), w('B', 'staff', 0, 7, 12, 3));
    expect(canMove(l, 'hero', 'up')).toBe(false);
    expect(canMove(l, 'hero', 'down')).toBe(false);
    expect(canMove(l, 'A', 'up')).toBe(false);
    expect(canMove(l, 'A', 'down')).toBe(true);
    expect(canMove(l, 'B', 'down')).toBe(false);
    expect(canMove(l, 'B', 'up')).toBe(true);
    expect(moveInstance(l, 'hero', 'down')).toBe(l);
    expect(moveInstance(l, 'A', 'up')).toBe(l);
    expect(moveInstance(l, 'nope', 'up')).toBe(l);
  });
  it('the ragged case: [A6 h4, B6 h1] then [C6 D6] — D floats beside A, and the list shows what the phone shows', () => {
    const l = flowLayout(L(), [hero, w('A', 'standings', 0, 0, 6, 4), w('B', 'schedule', 0, 0, 6, 1), w('C', 'news', 0, 0, 6, 2), w('D', 'contact', 0, 0, 6, 2)]);
    expect(at(l, 'D')).toMatchObject({ x: 6, y: 4 });
    expect(ids(l)).toEqual(['hero', 'A', 'B', 'D', 'C']);
    sound(l);
  });
});

describe('resizeToPreset', () => {
  it('A wide in [A6 B6] → A on its own row, B keeps w6 below at x0; B small → [A6 B4] on one row', () => {
    const l = L(hero, w('A', 'standings', 0, 3, 6, 4), w('B', 'contact', 6, 3, 6, 4));
    const wide = resizeToPreset(l, 'A', 'wide');
    expect(at(wide, 'A')).toMatchObject({ x: 0, y: 3, w: 12 });
    expect(at(wide, 'B')).toMatchObject({ x: 0, y: 7, w: 6 });
    sound(wide);
    const small = resizeToPreset(l, 'B', 'small');
    expect(at(small, 'A')).toMatchObject({ x: 0, y: 3, w: 6 });
    expect(at(small, 'B')).toMatchObject({ x: 6, y: 3, w: 4 });
    sound(small);
  });
  it('clamps to the constraints (a table cannot go small) and no-ops as the same object', () => {
    const l = L(hero, w('A', 'standings', 0, 3, 6, 4), w('B', 'contact', 6, 3, 6, 4));
    expect(resizeToPreset(l, 'A', 'small')).toBe(l); // TABLE minW 6 → clamps back to 6
    expect(resizeToPreset(l, 'A', 'medium')).toBe(l);
    expect(resizeToPreset(l, 'hero', 'small')).toBe(l);
    expect(resizeToPreset(l, 'nope', 'wide')).toBe(l);
  });
});
