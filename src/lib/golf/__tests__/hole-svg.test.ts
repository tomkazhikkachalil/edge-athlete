import { describe, expect, it } from 'vitest';
import { courseOverview, holeDiagram, holeYards, parseStoredHoleGeometry, projectLines } from '../hole-svg';
import { polylineYards } from '../hole-geometry';

// A due-north 400-ish yard hole at 45°N: tee at the south, green north.
const north: [number, number][] = [
  [45.3, -75.9],
  [45.3018, -75.9],
  [45.3036, -75.9],
];
// A dogleg east.
const dogleg: [number, number][] = [
  [45.3, -75.9],
  [45.302, -75.9],
  [45.302, -75.897],
];

describe('parseStoredHoleGeometry — the stored jsonb shape', () => {
  it('accepts the cached OSM shape, sorts holes, drops short lines', () => {
    const g = parseStoredHoleGeometry({
      source: 'osm',
      holes: [
        { hole: 2, par: 4, line: dogleg },
        { hole: 1, par: null, line: north },
        { hole: 3, par: 3, line: [[45.3, -75.9]] },
        { hole: 'x', line: north },
      ],
    })!;
    expect(g.source).toBe('osm');
    expect(g.holes.map(h => h.hole)).toEqual([1, 2]);
    expect(g.holes[0].par).toBeNull();
  });
  it('rejects junk, a foreign source, out-of-range coordinates', () => {
    expect(parseStoredHoleGeometry(null)).toBeNull();
    expect(parseStoredHoleGeometry('osm')).toBeNull();
    expect(parseStoredHoleGeometry({ source: 'other', holes: [{ hole: 1, line: north }] })).toBeNull();
    expect(parseStoredHoleGeometry({ source: 'osm', holes: [] })).toBeNull();
    expect(
      parseStoredHoleGeometry({ source: 'osm', holes: [{ hole: 1, line: [[95, 0], [96, 0]] }] })
    ).toBeNull();
  });
});

describe('projectLines — equirectangular, aspect-preserved, padded', () => {
  it('a due-north line is vertical, tee at the bottom, green at the top', () => {
    const p = projectLines([north], 100, 10)!;
    expect(p.viewBox).toBe('0 0 100 100');
    expect(p.tee[0].x).toBe(p.green[0].x);
    expect(p.tee[0].y).toBeGreaterThan(p.green[0].y);
    expect(p.green[0].y).toBe(10); // top padding
    expect(p.tee[0].y).toBe(90); // bottom padding
    expect(p.paths[0].startsWith('M ')).toBe(true);
    expect(p.paths[0].split(' L ').length).toBe(3);
  });
  it('every point stays inside the padded box; aspect is preserved', () => {
    const p = projectLines([dogleg], 100, 10)!;
    for (const pt of [...p.tee, ...p.green]) {
      expect(pt.x).toBeGreaterThanOrEqual(10);
      expect(pt.x).toBeLessThanOrEqual(90);
      expect(pt.y).toBeGreaterThanOrEqual(10);
      expect(pt.y).toBeLessThanOrEqual(90);
    }
    // The east leg (~236 m) is shorter than the north leg (~222 m)? No —
    // 0.003° lng at 45°N ≈ 236 m, 0.002° lat ≈ 222 m: x-range > y-range,
    // so the width fills the box and the height does not.
    const dx = Math.abs(p.green[0].x - p.tee[0].x);
    const dy = Math.abs(p.green[0].y - p.tee[0].y);
    expect(dx).toBe(80);
    expect(dy).toBeLessThan(80);
    expect(dy).toBeGreaterThan(60);
  });
  it('the label anchor sits between the green and the centre', () => {
    const p = projectLines([north], 100, 10)!;
    expect(p.label[0].y).toBeGreaterThan(p.green[0].y);
    expect(p.label[0].y).toBeLessThan(50);
  });
  it('empty input → null; a single point still draws (degenerate range)', () => {
    expect(projectLines([])).toBeNull();
    expect(projectLines([[[45.3, -75.9], [45.3, -75.9]]])).not.toBeNull();
  });
});

describe('holeDiagram / courseOverview / holeYards', () => {
  const hole = { hole: 1, par: 4, line: north };
  it('yards match the polyline length helper', () => {
    expect(holeYards(hole)).toBe(polylineYards(north));
    expect(holeYards(hole)).toBeGreaterThan(400);
    expect(holeYards(hole)).toBeLessThan(450);
  });
  it('one path per hole in the overview, larger default box', () => {
    const o = courseOverview([hole, { hole: 2, par: 4, line: dogleg }])!;
    expect(o.paths.length).toBe(2);
    expect(o.viewBox).toBe('0 0 200 200');
    expect(holeDiagram(hole)!.paths.length).toBe(1);
  });
});
