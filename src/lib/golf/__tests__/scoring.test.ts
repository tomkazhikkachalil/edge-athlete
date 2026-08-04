import { describe, it, expect } from 'vitest';
import {
  holePar,
  classifyScore,
  toParLabel,
  toParColorClass,
  calcPlayerTotals,
  buildDefaultHoles,
  STANDARD_PARS_18,
} from '../scoring';

describe('buildDefaultHoles', () => {
  it('builds 18 holes numbered 1-18 with the standard par distribution (sum 72)', () => {
    const holes = buildDefaultHoles(18, 'front');
    expect(holes).toHaveLength(18);
    expect(holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(holes.map(h => h.par)).toEqual(STANDARD_PARS_18);
    expect(holes.reduce((sum, h) => sum + h.par, 0)).toBe(72);
  });

  it('builds front-9 rounds as holes 1-9', () => {
    const holes = buildDefaultHoles(9, 'front');
    expect(holes.map(h => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(holes.map(h => h.par)).toEqual(STANDARD_PARS_18.slice(0, 9));
  });

  it('builds back-9 rounds as holes 10-18 with the back-nine par slice (sum 36)', () => {
    const holes = buildDefaultHoles(9, 'back');
    expect(holes.map(h => h.hole)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(holes.map(h => h.par)).toEqual(STANDARD_PARS_18.slice(9));
    expect(holes.reduce((sum, h) => sum + h.par, 0)).toBe(36);
  });

  it('marks par-3 holes fairway "na" and leaves par 4/5 undefined', () => {
    for (const h of buildDefaultHoles(18, 'front')) {
      expect(h.fairway).toBe(h.par === 3 ? 'na' : undefined);
    }
  });

  it('assigns deterministic yardages by par (150/380/520 — jitter removed on purpose)', () => {
    for (const h of buildDefaultHoles(18, 'front')) {
      expect(h.yardage).toBe(h.par === 3 ? 150 : h.par === 4 ? 380 : 520);
    }
  });

  it('starts every hole unscored', () => {
    expect(buildDefaultHoles(18, 'front').every(h => h.score === undefined)).toBe(true);
  });
});

describe('holePar', () => {
  it('returns the fallback (4) when there is no hole data', () => {
    expect(holePar(1, null)).toBe(4);
    expect(holePar(7, undefined)).toBe(4);
  });

  it('honors a custom fallback', () => {
    expect(holePar(1, null, 3)).toBe(3);
  });

  it('reads the real par from course hole data', () => {
    const data = [{ hole: 1, par: 5 }, { hole: 2, par: 3 }];
    expect(holePar(1, data)).toBe(5);
    expect(holePar(2, data)).toBe(3);
  });

  it('falls back for a hole missing from the data', () => {
    expect(holePar(9, [{ hole: 1, par: 5 }])).toBe(4);
  });
});

describe('classifyScore', () => {
  it('classifies each band relative to par', () => {
    expect(classifyScore(2, 4)).toBe('eagle');   // -2
    expect(classifyScore(1, 4)).toBe('eagle');   // -3, still eagle-or-better
    expect(classifyScore(3, 4)).toBe('birdie');  // -1
    expect(classifyScore(4, 4)).toBe('par');     // 0
    expect(classifyScore(5, 4)).toBe('bogey');   // +1
    expect(classifyScore(6, 4)).toBe('double');  // +2
    expect(classifyScore(9, 4)).toBe('double');  // +5, still double+
  });

  it('classifies against the ACTUAL hole par (regression: par-4 shadow bug)', () => {
    // A 4 on a par 5 is a birdie, not a par — the grid used to style every
    // cell as par 4 because a local `const holePar = 4` shadowed real data.
    expect(classifyScore(4, 5)).toBe('birdie');
    expect(classifyScore(4, 3)).toBe('bogey');
  });

  it('returns null for no score', () => {
    expect(classifyScore(0, 4)).toBeNull();
    expect(classifyScore(null, 4)).toBeNull();
    expect(classifyScore(undefined, 4)).toBeNull();
  });
});

describe('toParLabel', () => {
  it('formats even, over, and under par', () => {
    expect(toParLabel(0)).toBe('E');
    expect(toParLabel(3)).toBe('+3');
    expect(toParLabel(-2)).toBe('-2');
  });
  it('handles null/undefined', () => {
    expect(toParLabel(null)).toBe('—');
    expect(toParLabel(undefined)).toBe('—');
  });
});

describe('toParColorClass', () => {
  it('under par is green, over is red, even is gray (app-wide convention)', () => {
    expect(toParColorClass(-1)).toContain('green');
    expect(toParColorClass(3)).toContain('red');
    expect(toParColorClass(0)).toContain('gray');
    expect(toParColorClass(null)).toContain('gray');
  });
});

describe('calcPlayerTotals', () => {
  it('returns empty totals when no holes have a score', () => {
    const t = calcPlayerTotals([{ hole_number: 1, strokes: 0 }, { hole_number: 2, strokes: null }]);
    expect(t.total).toBe(0);
    expect(t.played).toBe(0);
    expect(t.toPar).toBe(0);
  });

  it('sums front/back and computes to-par against PLAYED holes only', () => {
    // 9-hole partial: 3 holes played, all par 4 (fallback)
    const t = calcPlayerTotals([
      { hole_number: 1, strokes: 4 },
      { hole_number: 2, strokes: 5 },
      { hole_number: 3, strokes: 3 },
    ]);
    expect(t.played).toBe(3);
    expect(t.total).toBe(12);
    expect(t.front9).toBe(12);
    expect(t.back9).toBe(0);
    expect(t.actualPar).toBe(12); // 3 × par 4
    expect(t.toPar).toBe(0);
  });

  it('splits front and back nine correctly', () => {
    const t = calcPlayerTotals([
      { hole_number: 9, strokes: 4 },
      { hole_number: 10, strokes: 5 },
    ]);
    expect(t.front9).toBe(4);
    expect(t.back9).toBe(5);
  });

  it('classifies with real course pars', () => {
    const holeData = [{ hole: 1, par: 5 }, { hole: 2, par: 3 }];
    const t = calcPlayerTotals(
      [{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }],
      holeData
    );
    expect(t.birdies).toBe(1); // 4 on par 5
    expect(t.bogeys).toBe(1);  // 4 on par 3
    expect(t.actualPar).toBe(8); // 5 + 3
    expect(t.toPar).toBe(0);     // 8 strokes vs par 8
  });
});
