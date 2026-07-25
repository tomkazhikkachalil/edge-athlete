import { describe, it, expect } from 'vitest';
import { buildMirrorHoles } from '../round-mirror';

const hole = (hole_number: number, strokes: number) => ({
  hole_number, strokes, putts: 2, fairway_hit: true, green_in_regulation: false,
});

describe('buildMirrorHoles', () => {
  it('takes par and yardage from the round hole_data', () => {
    const rows = buildMirrorHoles(
      [hole(1, 4), hole(2, 3)],
      [
        { hole: 1, par: 5, yardage: 520 },
        { hole: 2, par: 3, yardage: 165 },
      ]
    );
    expect(rows[0]).toMatchObject({ hole_number: 1, par: 5, distance_yards: 520, strokes: 4 });
    expect(rows[1]).toMatchObject({ hole_number: 2, par: 3, distance_yards: 165, strokes: 3 });
  });

  it('falls back to par 4 / null yardage when hole_data is absent or missing the hole', () => {
    const rows = buildMirrorHoles([hole(7, 6)], null);
    expect(rows[0]).toMatchObject({ hole_number: 7, par: 4, distance_yards: null });

    const partial = buildMirrorHoles([hole(7, 6)], [{ hole: 1, par: 5 }]);
    expect(partial[0].par).toBe(4);
  });

  it('carries all score fields through', () => {
    const rows = buildMirrorHoles([hole(3, 5)], [{ hole: 3, par: 4 }]);
    expect(rows[0]).toEqual({
      hole_number: 3, par: 4, distance_yards: null,
      strokes: 5, putts: 2, fairway_hit: true, green_in_regulation: false,
    });
  });
});
