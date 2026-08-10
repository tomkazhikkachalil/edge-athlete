import { describe, it, expect } from 'vitest';
import { buildHoleRecords } from '../post-write';

describe('buildHoleRecords', () => {
  it('drops holes without a score', () => {
    const rows = buildHoleRecords(
      [
        { hole: 1, par: 4, score: 5 },
        { hole: 2, par: 3 }, // no score entered
        { hole: 3, par: 5, score: 4 },
      ],
      'r-1'
    );
    expect(rows.map(r => r.hole_number)).toEqual([1, 3]);
    expect(rows.every(r => r.round_id === 'r-1')).toBe(true);
  });

  it('maps fairway: hit→true, na→null, anything else→false', () => {
    const [hit, na, miss, absent] = buildHoleRecords(
      [
        { hole: 1, par: 4, score: 4, fairway: 'hit' },
        { hole: 2, par: 4, score: 4, fairway: 'na' },
        { hole: 3, par: 4, score: 4, fairway: 'miss' },
        { hole: 4, par: 4, score: 4 },
      ],
      'r-1'
    );
    expect(hit.fairway_hit).toBe(true);
    expect(na.fairway_hit).toBeNull();
    expect(miss.fairway_hit).toBe(false);
    expect(absent.fairway_hit).toBe(false);
  });

  it('gir defaults false; notes default null; score 0 survives the filter', () => {
    const [row] = buildHoleRecords([{ hole: 1, par: 3, score: 0 }], 'r-1');
    expect(row.strokes).toBe(0);
    expect(row.green_in_regulation).toBe(false);
    expect(row.notes).toBeNull();
  });
});
