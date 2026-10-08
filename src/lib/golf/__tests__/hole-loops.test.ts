import { describe, it, expect } from 'vitest';
import { geometryForRound, pickLoop, pickerRows, sectionAsGeometry, LOOP_AUTOPICK_M } from '../hole-loops';
import type { HoleGeometry, HoleSection } from '../hole-geometry';

// PR 4: nothing is drawn before a pick or an unmistakable GPS match.

const M = (2 * Math.PI * 6371000) / 360;
const nine = (label: string, lat0: number, lng0: number): HoleSection => ({
  label,
  holes: Array.from({ length: 9 }, (_, i) => ({ hole: i + 1, par: 4, line: [[lat0 + i * 0.001, lng0], [lat0 + i * 0.001 + 0.0005, lng0]] as [number, number][] })),
  greens: [{ hole: 1, ring: [[lat0 + 0.0005, lng0], [lat0 + 0.0006, lng0], [lat0 + 0.0006, lng0 + 0.0001], [lat0 + 0.0005, lng0 + 0.0001]] }],
});
const A = nine('A', 45.3, -75.7);
const B = nine('B', 45.3, -75.69); // ~780 m east
const C = nine('C', 45.3, -75.68);
const club: HoleGeometry = { holes: [], source: 'osm', greens: [], sections: [A, B, C] };

describe('pickLoop', () => {
  it('the player’s pick wins; an unknown label is ignored', () => {
    expect(pickLoop([A, B, C], { chosen: 'B' })).toBe(B);
    expect(pickLoop([A, B, C], { chosen: 'Z', fix: null })).toBeNull();
  });
  it('auto-picks the ONE loop with a tee within 150 m when every rival tee is clearly farther', () => {
    const onA: [number, number] = [45.3 + 100 / M, -75.7];
    expect(pickLoop([A, B, C], { fix: onA })).toBe(A);
    expect(LOOP_AUTOPICK_M).toBe(150);
    const far: [number, number] = [45.31, -75.7];
    expect(pickLoop([A, B, C], { fix: far })).toBeNull();
  });
  it('two loops sharing a hub (rival tee within 2×) → no auto-pick', () => {
    const D = nine('D', 45.3, -75.7 + 180 / (M * Math.cos((45.3 * Math.PI) / 180))); // 180 m east of A
    const between: [number, number] = [45.3, -75.7 + 80 / (M * Math.cos((45.3 * Math.PI) / 180))];
    expect(pickLoop([A, D], { fix: between })).toBeNull();
  });
});

describe('geometryForRound + pickerRows', () => {
  it('a 9-hole round on nines: one row, the picked loop whole; nothing before a pick', () => {
    expect(pickerRows(club, 9)).toEqual([{ key: 'front', labels: ['A', 'B', 'C'] }]);
    expect(geometryForRound(club, { holesPlayed: 9, picks: { front: null, back: null } })).toBeNull();
    const g = geometryForRound(club, { holesPlayed: 9, picks: { front: 'C', back: null } })!;
    expect(g.holes).toBe(C.holes);
    expect(g.greens).toBe(C.greens);
  });
  it('an 18-hole round on nines: front + back, the back renumbered 10–18; the front may auto-pick, the back never', () => {
    expect(pickerRows(club, 18)).toEqual([{ key: 'front', labels: ['A', 'B', 'C'] }, { key: 'back', labels: ['A', 'B', 'C'] }]);
    const onA: [number, number] = [45.3 + 100 / M, -75.7];
    expect(geometryForRound(club, { holesPlayed: 18, fix: onA, picks: { front: null, back: null } })).toBeNull();
    const g = geometryForRound(club, { holesPlayed: 18, fix: onA, picks: { front: null, back: 'B' } })!;
    expect(g.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(g.holes[9].line).toBe(B.holes[0].line);
    expect(geometryForRound(club, { holesPlayed: 18, picks: { front: 'B', back: 'B' } })).toBeNull(); // the same nine twice is no 18
  });
  it('an 18-section club: one row over the 18s; a back-nine round numbered 10–18 finds its holes in the whole', () => {
    const eighteen: HoleSection = { label: 'A', holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, par: 4, line: [[45.3 + i * 0.001, -75.7], [45.3005 + i * 0.001, -75.7]] as [number, number][] })) };
    const g: HoleGeometry = { holes: [], source: 'osm', sections: [eighteen, A] };
    expect(pickerRows(g, 18)).toEqual([{ key: 'front', labels: ['A'] }]);
    expect(geometryForRound(g, { holesPlayed: 18, picks: { front: 'A', back: null } })!.holes).toHaveLength(18);
    expect(geometryForRound(g, { holesPlayed: 9, picks: { front: 'A', back: null } })!.holes).toHaveLength(18);
  });
  it('a geometry without sections passes through; sectionAsGeometry carries the greens', () => {
    const plain: HoleGeometry = { holes: A.holes, source: 'osm', greens: [] };
    expect(geometryForRound(plain, { holesPlayed: 9, picks: { front: null, back: null } })).toBe(plain);
    expect(geometryForRound(null, { holesPlayed: 9, picks: { front: null, back: null } })).toBeNull();
    expect(sectionAsGeometry(A).greens).toBe(A.greens);
    expect(pickerRows(plain, 9)).toEqual([]);
  });
});
