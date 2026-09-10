import { describe, expect, it } from 'vitest';
import { canvasLayoutFor } from '../canvas-layout';
import type { SiteLayout } from '../layout';

const L = (tag: string): SiteLayout => ({ version: 1, cols: 12, widgets: [{ id: tag, key: 'hero', x: 0, y: 0, w: 12, h: 3, cv: 1, config: {}, visibility: 'public' }] });

// Backlog B1: which layout the canvas shows.
describe('canvasLayoutFor', () => {
  it('draft with a layout → it; draft WITHOUT one → the seed, never the published; no draft → published, else seed', () => {
    const stored = L('stored'), published = L('published'), seed = L('seed');
    expect(canvasLayoutFor({ hasDraft: true, stored, published, seed: () => seed })).toBe(stored);
    expect(canvasLayoutFor({ hasDraft: true, stored: null, published, seed: () => seed })).toBe(seed);
    expect(canvasLayoutFor({ hasDraft: false, stored: null, published, seed: () => seed })).toBe(published);
    expect(canvasLayoutFor({ hasDraft: false, stored: null, published: null, seed: () => seed })).toBe(seed);
  });
});
