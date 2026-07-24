import { describe, it, expect } from 'vitest';
import {
  holePar,
  classifyScore,
  toParLabel,
  toParColorClass,
  calcPlayerTotals,
} from '../scoring';

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
