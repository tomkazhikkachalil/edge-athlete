/**
 * Perspective (keystone) correction math — PURE, node-tested, and the
 * single source for the warp constants (the GLSL in shaders.ts
 * interpolates them; the CPU warp below composes them).
 *
 * Model: an inverse projective mapping in centered, Y-UP normalized
 * coordinates (x, y ∈ [−0.5, 0.5], top = +0.5 — the GL convention; the
 * CPU wrapper converts from row space). For an OUTPUT pixel at (x, y),
 * the divisor
 *     w = 1 + PERSPECTIVE_SCALE · (vertical·y + horizontal·x)
 * scales where in the SOURCE we sample: (x·w, y·w). Samples outside the
 * source render black — the classic keystone trapezoid the user then
 * crops (or leaves; it's honest about what correction costs).
 *
 * With sliders in −1..1, w stays inside [0.6, 1.4] at the corners —
 * comfortably clear of the projective singularity, so no guard is needed.
 */

import type { PerspectiveCorrection } from '../types';

export const PERSPECTIVE_SCALE = 0.4;

export type PerspectiveParams = PerspectiveCorrection;

export const NEUTRAL_PERSPECTIVE: PerspectiveParams = { vertical: 0, horizontal: 0 };

export function isNeutralPerspective(p: PerspectiveParams | undefined | null): boolean {
  return !p || (p.vertical === 0 && p.horizontal === 0);
}

/** Source coordinate (same centered Y-up space) for an output pixel, or
 *  null when the sample falls outside the source. */
export function perspectiveSourceCoord(
  x: number,
  y: number,
  perspective: PerspectiveParams
): { x: number; y: number } | null {
  const w = 1 + PERSPECTIVE_SCALE * (perspective.vertical * y + perspective.horizontal * x);
  const sx = x * w;
  const sy = y * w;
  if (Math.abs(sx) > 0.5 || Math.abs(sy) > 0.5) return null;
  return { x: sx, y: sy };
}

/**
 * CPU warp over RGBA bytes (bilinear), the reference/export-fallback twin
 * of the GPU warp pass. Out-of-source pixels become opaque black.
 */
export function warpPerspective(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  perspective: PerspectiveParams
): void {
  if (isNeutralPerspective(perspective)) return;
  const src = data.slice();
  const sample = (fx: number, fy: number, c: number): number => {
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)));
    const x1 = Math.min(width - 1, x0 + 1);
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)));
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const p00 = src[(y0 * width + x0) * 4 + c];
    const p10 = src[(y0 * width + x1) * 4 + c];
    const p01 = src[(y1 * width + x0) * 4 + c];
    const p11 = src[(y1 * width + x1) * 4 + c];
    return p00 * (1 - tx) * (1 - ty) + p10 * tx * (1 - ty) + p01 * (1 - tx) * ty + p11 * tx * ty;
  };
  for (let row = 0; row < height; row++) {
    // Row space (top = row 0) → centered Y-up (top = +0.5).
    const yc = 0.5 - (row + 0.5) / height;
    for (let col = 0; col < width; col++) {
      const xc = (col + 0.5) / width - 0.5;
      const i = (row * width + col) * 4;
      const coord = perspectiveSourceCoord(xc, yc, perspective);
      if (!coord) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }
      const fx = (coord.x + 0.5) * width - 0.5;
      const fy = (0.5 - coord.y) * height - 0.5;
      data[i] = sample(fx, fy, 0);
      data[i + 1] = sample(fx, fy, 1);
      data[i + 2] = sample(fx, fy, 2);
      data[i + 3] = 255;
    }
  }
}
