import { describe, it, expect } from 'vitest';
import {
  addPoint,
  applyCurveLut,
  bakeCurveLut,
  CURVE_LUT_SIZE,
  evaluateCurve,
  IDENTITY_CURVE,
  isIdentityCurve,
  isNeutralCurves,
  MAX_CURVE_POINTS,
  MIN_POINT_GAP,
  movePoint,
  removePoint,
} from '../curves-math';
import type { CurvePoint } from '../../types';

const sCurve: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 0.25, y: 0.15 },
  { x: 0.75, y: 0.85 },
  { x: 1, y: 1 },
];

describe('evaluateCurve', () => {
  it('the identity curve is the identity', () => {
    for (const x of [0, 0.2, 0.5, 0.77, 1]) {
      expect(evaluateCurve(IDENTITY_CURVE, x)).toBeCloseTo(x, 6);
    }
  });

  it('interpolates through every control point exactly', () => {
    for (const p of sCurve) {
      expect(evaluateCurve(sCurve, p.x)).toBeCloseTo(p.y, 6);
    }
  });

  it('clamps flat outside the first/last point', () => {
    const lifted: CurvePoint[] = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.7 },
    ];
    expect(evaluateCurve(lifted, 0)).toBe(0.3);
    expect(evaluateCurve(lifted, 1)).toBe(0.7);
  });

  it('monotone input points yield a monotone curve (Fritsch–Carlson, no overshoot)', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = evaluateCurve(sCurve, i / 200);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('an s-curve steepens the midtones and softens the toes', () => {
    expect(evaluateCurve(sCurve, 0.1)).toBeLessThan(0.1); // toe pulled down
    expect(evaluateCurve(sCurve, 0.9)).toBeGreaterThan(0.9); // shoulder lifted
    expect(evaluateCurve(sCurve, 0.5)).toBeCloseTo(0.5, 1); // pivot ~centered
  });
});

describe('bakeCurveLut + applyCurveLut', () => {
  it('empty and identity curve sets bake a true identity LUT', () => {
    for (const curves of [{}, { master: IDENTITY_CURVE }]) {
      const lut = bakeCurveLut(curves);
      expect(lut).toHaveLength(CURVE_LUT_SIZE * 4);
      for (let bin = 0; bin < CURVE_LUT_SIZE; bin++) {
        expect(lut[bin * 4]).toBe(bin);
        expect(lut[bin * 4 + 1]).toBe(bin);
        expect(lut[bin * 4 + 2]).toBe(bin);
      }
    }
  });

  it('master composes BEFORE per-channel curves', () => {
    // Master darkens everything to 0.5·x; a 2-point red gain curve (two
    // points → equal hermite tangents → exactly linear) doubles it back.
    // Red returns to x, green/blue stay halved.
    const curves = {
      master: [
        { x: 0, y: 0 },
        { x: 1, y: 0.5 },
      ],
      r: [
        { x: 0, y: 0 },
        { x: 0.5, y: 1 },
      ],
    };
    const [r, g, b] = applyCurveLut([0.8, 0.8, 0.8], bakeCurveLut(curves));
    expect(g).toBeCloseTo(0.4, 2);
    expect(b).toBeCloseTo(0.4, 2);
    expect(r).toBeCloseTo(0.8, 2); // 0.5·0.8 = 0.4 → ×2 gain → 0.8
  });

  it('a lifted-blacks curve raises shadows through the LUT', () => {
    const faded = {
      master: [
        { x: 0, y: 0.15 },
        { x: 1, y: 1 },
      ],
    };
    const [r] = applyCurveLut([0, 0, 0], bakeCurveLut(faded));
    expect(r).toBeCloseTo(0.15, 2);
  });
});

describe('point-editing rules', () => {
  it('endpoint x is pinned; interior x clamps between neighbors', () => {
    const moved = movePoint(sCurve, 0, 0.4, 0.2);
    expect(moved[0].x).toBe(0); // pinned
    expect(moved[0].y).toBe(0.2);
    const interior = movePoint(sCurve, 1, 0.9, 0.5);
    expect(interior[1].x).toBeCloseTo(0.75 - MIN_POINT_GAP); // stopped at neighbor
  });

  it('addPoint keeps order, enforces the gap, and respects the cap', () => {
    const added = addPoint(sCurve, 0.5, 0.6)!;
    expect(added.map(p => p.x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(addPoint(sCurve, 0.251, 0.5)).toBeNull(); // too close
    let full = IDENTITY_CURVE;
    for (let i = 1; i < MAX_CURVE_POINTS - 1; i++) {
      full = addPoint(full, i / (MAX_CURVE_POINTS - 1), 0.5) ?? full;
    }
    expect(full).toHaveLength(MAX_CURVE_POINTS);
    expect(addPoint(full, 0.33, 0.5)).toBeNull(); // at capacity
  });

  it('removePoint refuses endpoints and short curves', () => {
    expect(removePoint(sCurve, 0)).toBeNull();
    expect(removePoint(sCurve, 3)).toBeNull();
    expect(removePoint(sCurve, 1)!.map(p => p.x)).toEqual([0, 0.75, 1]);
    expect(removePoint(IDENTITY_CURVE, 1)).toBeNull(); // endpoint of 2-point
  });
});

describe('neutrality', () => {
  it('absent, empty, and identity channels are neutral; any shaping is not', () => {
    expect(isNeutralCurves(undefined)).toBe(true);
    expect(isNeutralCurves({})).toBe(true);
    expect(isNeutralCurves({ master: IDENTITY_CURVE, b: IDENTITY_CURVE })).toBe(true);
    expect(isNeutralCurves({ master: sCurve })).toBe(false);
    expect(isIdentityCurve(sCurve)).toBe(false);
  });
});
