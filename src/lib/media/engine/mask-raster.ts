/**
 * Brush-mask rasterization (Phase 2, round E4f) — PURE, node-tested.
 *
 * A brush mask's weight can't be a closed form, so its strokes rasterize
 * into a coverage buffer (half the engine source resolution) that the GPU
 * samples as a texture and the CPU reference samples bilinearly. The
 * rasterizer is deliberately OURS rather than canvas-2D: canvas gradients
 * aren't reproducible in node, and parity-by-construction (one function,
 * two consumers) is the engine's house rule.
 *
 * Model: each stroke stamps feathered discs along its polyline at
 * radius/2 spacing. Paint composes `max(mask, w)` (overlapping strokes
 * never over-brighten); erase composes `mask·(1−w)`. Stamp falloff reuses
 * the radial mask's curve: 1 inside the feather-shrunk core, smoothstep
 * to 0 at the disc edge.
 *
 * Coordinates: stroke points are normalized to the FRAMED image, ORIGIN
 * TOP-LEFT (the pointer convention, same as the other mask kinds).
 * Buffers are row-major from the top — the shader flips its y once when
 * sampling.
 */

import { smoothstep } from './color-math';
import type { BrushStroke } from '../types';

/** Schema caps (also enforced by zod in recipes.ts). */
export const MAX_STROKES_PER_MASK = 32;
export const MAX_POINTS_PER_STROKE = 256;

/** Pointer-move decimation: a new point must be at least this fraction of
 *  the stroke radius away from the last kept one. */
export const DECIMATION_RADIUS_FRACTION = 0.25;

/** Append a pointer sample to a stroke's points, decimated. Returns the
 *  SAME array when the point is dropped (too close / at capacity). */
export function appendStrokePoint(
  points: Array<{ x: number; y: number }>,
  x: number,
  y: number,
  radius: number
): Array<{ x: number; y: number }> {
  if (points.length >= MAX_POINTS_PER_STROKE) return points;
  const last = points[points.length - 1];
  if (last) {
    const minDist = radius * DECIMATION_RADIUS_FRACTION;
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < minDist * minDist) return points;
  }
  return [...points, { x, y }];
}

/** Stamp one feathered disc into the buffer (in place). `cx/cy/radius`
 *  are normalized against WIDTH (radius circular in image space via the
 *  aspect term, like radial masks measure on screen). */
function stampDisc(
  buffer: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  feather: number,
  erase: boolean
): void {
  const aspect = width / height;
  // Pixel bounds of the disc (radius is a fraction of image WIDTH).
  const rPxX = radius * width;
  const rPxY = radius * width; // same physical size — buffer px are square
  const x0 = Math.max(0, Math.floor(cx * width - rPxX - 1));
  const x1 = Math.min(width - 1, Math.ceil(cx * width + rPxX + 1));
  const y0 = Math.max(0, Math.floor(cy * height - rPxY - 1));
  const y1 = Math.min(height - 1, Math.ceil(cy * height + rPxY + 1));
  const inner = Math.max(0, 1 - feather);
  for (let py = y0; py <= y1; py++) {
    const v = (py + 0.5) / height;
    for (let px = x0; px <= x1; px++) {
      const u = (px + 0.5) / width;
      const du = (u - cx) / radius;
      const dv = (v - cy) / (radius * aspect); // v spans height; scale to width units
      const d = Math.sqrt(du * du + dv * dv);
      if (d >= 1) continue;
      const w = 1 - smoothstep(inner, 1, d);
      if (w <= 0) continue;
      const i = py * width + px;
      buffer[i] = erase ? buffer[i] * (1 - w) : Math.max(buffer[i], w);
    }
  }
}

/** Stamp a whole stroke (discs along the polyline at radius/2 spacing). */
export function stampStroke(
  buffer: Float32Array,
  width: number,
  height: number,
  stroke: BrushStroke,
  fromPointIndex = 0
): void {
  const { points, radius, feather } = stroke;
  const erase = stroke.erase === true;
  if (points.length === 0) return;
  const start = Math.max(0, fromPointIndex);
  if (start === 0) {
    stampDisc(buffer, width, height, points[0].x, points[0].y, radius, feather, erase);
  }
  const spacing = radius / 2;
  for (let s = Math.max(1, start); s < points.length; s++) {
    const a = points[s - 1];
    const b = points[s];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      stampDisc(buffer, width, height, a.x + dx * t, a.y + dy * t, radius, feather, erase);
    }
  }
}

/** Full rasterization of a brush mask's strokes, in order. */
export function rasterizeBrushMask(
  strokes: BrushStroke[],
  width: number,
  height: number
): Float32Array {
  const buffer = new Float32Array(width * height);
  for (const stroke of strokes) stampStroke(buffer, width, height, stroke);
  return buffer;
}

/**
 * Incremental update: when `next` merely EXTENDS `prev` (same strokes with
 * the last one possibly grown, plus optionally appended strokes — the
 * live-painting shape), stamp only what's new into `buffer` and return
 * true. Any other change (edited stroke, removal, erase order) returns
 * false and the caller re-rasterizes. Erase-stroke growth is safe: erase
 * multiplies, and only NEW stamps are applied.
 */
export function extendRaster(
  buffer: Float32Array,
  prev: BrushStroke[],
  next: BrushStroke[],
  width: number,
  height: number
): boolean {
  if (next.length < prev.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.radius !== b.radius || a.feather !== b.feather || (a.erase === true) !== (b.erase === true)) {
      return false;
    }
    // Only the LAST prev stroke may grow, and only while nothing was
    // appended after it (a stroke stops growing once the next one starts).
    const mayGrow = i === prev.length - 1 && next.length === prev.length;
    if (!mayGrow && a.points.length !== b.points.length) return false;
    if (b.points.length < a.points.length) return false;
    for (let p = 0; p < a.points.length; p++) {
      if (a.points[p].x !== b.points[p].x || a.points[p].y !== b.points[p].y) return false;
    }
  }
  // Stamp growth of the last shared stroke…
  if (prev.length > 0 && next.length === prev.length) {
    const i = prev.length - 1;
    if (next[i].points.length > prev[i].points.length) {
      stampStroke(buffer, width, height, next[i], prev[i].points.length);
    }
  }
  // …and any wholly new strokes.
  for (let i = prev.length; i < next.length; i++) {
    stampStroke(buffer, width, height, next[i]);
  }
  return true;
}

/** Bilinear sample at normalized (u, v), origin top-left — the CPU twin of
 *  the GPU's LINEAR texture fetch. */
export function sampleMaskBuffer(
  buffer: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number
): number {
  const fx = Math.min(width - 1, Math.max(0, u * width - 0.5));
  const fy = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  return (
    buffer[y0 * width + x0] * (1 - tx) * (1 - ty) +
    buffer[y0 * width + x1] * tx * (1 - ty) +
    buffer[y1 * width + x0] * (1 - tx) * ty +
    buffer[y1 * width + x1] * tx * ty
  );
}
