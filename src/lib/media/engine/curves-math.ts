/**
 * Tone curves (Phase 2, round E4b) — PURE, node-tested. Master + per-
 * channel R/G/B curves as control points, interpolated with Fritsch–
 * Carlson monotone cubic (no overshoot — a curve through rising points
 * never dips, which is what photo tools use) and baked into a 256-bin
 * LUT: bin x → (curveR(master(x)), curveG(master(x)), curveB(master(x))).
 * The SAME baked bytes feed the GPU texture and the CPU reference —
 * the hsl-math parity-by-construction pattern.
 *
 * Also home to the pure point-editing rules the SVG editor calls
 * (move/add/remove with neighbor clamping), so the interaction math is
 * testable without a DOM.
 */

import { clamp01, type Rgb } from './color-math';
import type { CurvePoint, CurveSet } from '../types';

export const CURVE_LUT_SIZE = 256;
export const MAX_CURVE_POINTS = 8;
/** Minimum x gap between adjacent control points. */
export const MIN_POINT_GAP = 0.02;

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const EPS = 1e-6;

export function isIdentityCurve(points: CurvePoint[] | undefined | null): boolean {
  if (!points || points.length === 0) return true;
  if (points.length !== 2) return false;
  return (
    Math.abs(points[0].x) < EPS &&
    Math.abs(points[0].y) < EPS &&
    Math.abs(points[1].x - 1) < EPS &&
    Math.abs(points[1].y - 1) < EPS
  );
}

export function isNeutralCurves(curves: CurveSet | undefined | null): boolean {
  if (!curves) return true;
  return (
    isIdentityCurve(curves.master) &&
    isIdentityCurve(curves.r) &&
    isIdentityCurve(curves.g) &&
    isIdentityCurve(curves.b)
  );
}

/** Fritsch–Carlson tangents for monotone cubic hermite interpolation. */
function monotoneTangents(points: CurvePoint[]): number[] {
  const n = points.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secants.push((points[i + 1].y - points[i].y) / Math.max(points[i + 1].x - points[i].x, EPS));
  }
  const m: number[] = new Array(n);
  m[0] = secants[0];
  m[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
  }
  // Limiter: keep the hermite segment monotone.
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(secants[i]) < EPS) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / secants[i];
    const b = m[i + 1] / secants[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * secants[i];
      m[i + 1] = t * b * secants[i];
    }
  }
  return m;
}

/** Evaluate a curve at x (0..1). Outside the first/last point it clamps to
 *  their y — the flat-shoulder convention. */
export function evaluateCurve(points: CurvePoint[], x: number): number {
  if (points.length === 0) return clamp01(x);
  if (points.length === 1) return clamp01(points[0].y);
  if (x <= points[0].x) return clamp01(points[0].y);
  if (x >= points[points.length - 1].x) return clamp01(points[points.length - 1].y);
  const m = monotoneTangents(points);
  let i = 0;
  while (x > points[i + 1].x) i++;
  const h = points[i + 1].x - points[i].x;
  const t = (x - points[i].x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return clamp01(
    h00 * points[i].y + h10 * h * m[i] + h01 * points[i + 1].y + h11 * h * m[i + 1]
  );
}

/** 256 RGBA bytes: per-channel output for input bin x, master applied
 *  first. Consumed verbatim by GPU texture and CPU reference. */
export function bakeCurveLut(curves: CurveSet): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(CURVE_LUT_SIZE * 4);
  const master = curves.master && !isIdentityCurve(curves.master) ? curves.master : null;
  const channels: Array<CurvePoint[] | null> = [curves.r ?? null, curves.g ?? null, curves.b ?? null].map(
    c => (c && !isIdentityCurve(c) ? c : null)
  );
  for (let bin = 0; bin < CURVE_LUT_SIZE; bin++) {
    const x = bin / (CURVE_LUT_SIZE - 1);
    const mx = master ? evaluateCurve(master, x) : x;
    for (let c = 0; c < 3; c++) {
      const channel = channels[c];
      const v = channel ? evaluateCurve(channel, mx) : mx;
      lut[bin * 4 + c] = Math.round(clamp01(v) * 255);
    }
    lut[bin * 4 + 3] = 255;
  }
  return lut;
}

/** Linear LUT fetch — the CPU twin of the GPU's LINEAR sample. */
function sampleLut(lut: Uint8ClampedArray, value: number, channel: number): number {
  const pos = clamp01(value) * (CURVE_LUT_SIZE - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(CURVE_LUT_SIZE - 1, i0 + 1);
  const t = pos - i0;
  return (lut[i0 * 4 + channel] * (1 - t) + lut[i1 * 4 + channel] * t) / 255;
}

/** Apply a baked curve LUT to one pixel (input clamped — closed domain). */
export function applyCurveLut(rgb: Rgb, lut: Uint8ClampedArray): Rgb {
  return [sampleLut(lut, rgb[0], 0), sampleLut(lut, rgb[1], 1), sampleLut(lut, rgb[2], 2)];
}

// ---- Point-editing rules (the SVG editor's pure core) ----

/** Move a point: endpoint x is pinned (0 / 1), interior x clamps between
 *  neighbors with MIN_POINT_GAP; y clamps to 0..1. Returns a new array. */
export function movePoint(
  points: CurvePoint[],
  index: number,
  x: number,
  y: number
): CurvePoint[] {
  const next = points.map(p => ({ ...p }));
  const isFirst = index === 0;
  const isLast = index === points.length - 1;
  let nx: number;
  if (isFirst) nx = 0;
  else if (isLast) nx = 1;
  else {
    nx = Math.min(
      points[index + 1].x - MIN_POINT_GAP,
      Math.max(points[index - 1].x + MIN_POINT_GAP, x)
    );
  }
  next[index] = { x: nx, y: clamp01(y) };
  return next;
}

/** Insert a point at (x, y). Null when at capacity or too close to an
 *  existing point's x. Result stays sorted. */
export function addPoint(points: CurvePoint[], x: number, y: number): CurvePoint[] | null {
  if (points.length >= MAX_CURVE_POINTS) return null;
  if (points.some(p => Math.abs(p.x - x) < MIN_POINT_GAP)) return null;
  const next = [...points.map(p => ({ ...p })), { x: clamp01(x), y: clamp01(y) }];
  next.sort((a, b) => a.x - b.x);
  return next;
}

/** Remove an interior point. Null for endpoints (they anchor the domain). */
export function removePoint(points: CurvePoint[], index: number): CurvePoint[] | null {
  if (index <= 0 || index >= points.length - 1) return null;
  return points.filter((_, i) => i !== index).map(p => ({ ...p }));
}
