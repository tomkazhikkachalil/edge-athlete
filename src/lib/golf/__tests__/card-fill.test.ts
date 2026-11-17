import { describe, it, expect } from 'vitest';
import { cardFillVerdict, distanceKm, linkDataset, parseDatasetLine, type FillCard } from '../card-fill';

// Nov 17 2026: the scorecard fill. A wrong card is worse than none, so both
// rules refuse on any doubt.

const ours = (id: string, name: string, lat: number | null = 45, lng: number | null = -75) => ({ id, name, lat, lng });
const theirs = (id: string, name: string, lat = 45.001, lng = -75.001) => ({ id, name, lat, lng });

describe('linkDataset', () => {
  it('links the same facility name within two kilometres', () => {
    const r = linkDataset([ours('a', 'Eagle Creek Golf Club')], [theirs('og-1', 'Eagle Creek Golf Course')]);
    expect(r.pairs).toEqual([{ id: 'a', og: 'og-1' }]);
  });

  it('does not link across more than two kilometres, or a different name', () => {
    expect(distanceKm(45, -75, 45.03, -75)).toBeGreaterThan(2);
    const far = linkDataset([ours('a', 'Eagle Creek Golf Club')], [theirs('og-1', 'Eagle Creek Golf Club', 45.03, -75)]);
    expect(far.pairs).toEqual([]);
    expect(far.unmatched).toBe(1);
    const other = linkDataset([ours('a', 'Eagle Creek Golf Club')], [theirs('og-1', 'Pine Valley Golf Club')]);
    expect(other.pairs).toEqual([]);
  });

  it('two candidates for one course is no link', () => {
    const r = linkDataset([ours('a', 'Eagle Creek Golf Club')], [theirs('og-1', 'Eagle Creek Golf Club'), theirs('og-2', 'Eagle Creek Golf Club', 45.002, -75.002)]);
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toBe(1);
  });

  it('one entry claimed by two of our rows links neither', () => {
    const r = linkDataset([ours('a', 'Eagle Creek Golf Club'), ours('b', 'Eagle Creek Golf Club', 45.002, -75.002)], [theirs('og-1', 'Eagle Creek Golf Club')]);
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toBe(2);
  });

  it('a row without coordinates is never linked', () => {
    const r = linkDataset([ours('a', 'Eagle Creek Golf Club', null, null)], [theirs('og-1', 'Eagle Creek Golf Club')]);
    expect(r.pairs).toEqual([]);
    expect(r.noCoords).toBe(1);
  });

  it('finds a candidate across a grid cell edge', () => {
    const r = linkDataset([ours('a', 'Eagle Creek Golf Club', 45.0999, -75.0001)], [theirs('og-1', 'Eagle Creek Golf Club', 45.1001, -74.9999)]);
    expect(r.pairs).toHaveLength(1);
  });
});

describe('parseDatasetLine', () => {
  it('reads a published feature (longitude first)', () => {
    const line = JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [-89.19, 37.14] }, properties: { id: 'og-1', name: 'Egyptian Country Club' } });
    expect(parseDatasetLine(line)).toEqual({ id: 'og-1', name: 'Egyptian Country Club', lat: 37.14, lng: -89.19 });
  });
  it('a line without an id, a name or a point is nothing', () => {
    expect(parseDatasetLine('not json')).toBeNull();
    expect(parseDatasetLine(JSON.stringify({ geometry: null, properties: { id: 'x', name: 'A' } }))).toBeNull();
    expect(parseDatasetLine(JSON.stringify({ geometry: { coordinates: [1, 2] }, properties: { id: 'x', name: ' ' } }))).toBeNull();
  });
});

describe('cardFillVerdict', () => {
  const row = { lat: 45, lng: -75, holes_count: null as number | null };
  const card = (n = 18, over: Partial<FillCard> = {}): FillCard => ({
    lat: 45.001, lng: -75.001, total_par: n * 4, holes_count: n,
    hole_data: Array.from({ length: n }, (_, i) => ({ number: i + 1, par: 4, yardage: { white: 380 + i } })),
    ...over,
  });
  const map = (n: number, par = 4) => Array.from({ length: n }, (_, i) => ({ number: i + 1, par }));

  it('a whole, consistent card is ok', () => {
    expect(cardFillVerdict(row, card(), null)).toBe('ok');
    expect(cardFillVerdict(row, card(9), map(9))).toBe('ok');
  });

  it('no course or no holes is no card', () => {
    expect(cardFillVerdict(row, null, null)).toBe('no_card');
    expect(cardFillVerdict(row, card(18, { hole_data: [] }), null)).toBe('no_card');
  });

  it('a card somewhere else is refused', () => {
    expect(cardFillVerdict(row, card(18, { lat: 46 }), null)).toBe('moved');
  });

  it('ten holes on a nine-hole course is refused (the live answer for Egyptian Country Club)', () => {
    expect(cardFillVerdict(row, card(10, { holes_count: 9, total_par: 36 }), null)).toBe('hole_count');
  });

  it('a gap in the numbering, or a count our row disagrees with, is refused', () => {
    const gap = card(9);
    gap.hole_data = gap.hole_data!.map(h => (h.number === 9 ? { ...h, number: 10 } : h));
    expect(cardFillVerdict(row, gap, null)).toBe('hole_count');
    expect(cardFillVerdict({ ...row, holes_count: 18 }, card(9), null)).toBe('hole_count');
  });

  it('pars that do not add up to the stated total, or an impossible par, are refused', () => {
    expect(cardFillVerdict(row, card(18, { total_par: 71 }), null)).toBe('par_sum');
    const odd = card();
    odd.hole_data = odd.hole_data!.map(h => (h.number === 1 ? { ...h, par: 7 } : h));
    expect(cardFillVerdict(row, { ...odd, total_par: 75 }, null)).toBe('par_sum');
  });

  it('a card with no yardage at all is refused', () => {
    const bare = card();
    bare.hole_data = bare.hole_data!.map(h => ({ ...h, yardage: {} }));
    expect(cardFillVerdict(row, bare, null)).toBe('no_yardage');
  });

  it('a card the map disagrees with is refused', () => {
    expect(cardFillVerdict(row, card(), map(18, 5))).toBe('map_disagrees');
    expect(cardFillVerdict(row, card(), map(9))).toBe('map_disagrees');
  });
});
