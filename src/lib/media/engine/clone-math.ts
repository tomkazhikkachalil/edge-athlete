/**
 * Clone stamp (Phase 2, round E4g — healing v1) — PURE, node-tested.
 * Honest retouching without AI: copy a feathered circle from elsewhere in
 * the FRAMED image over a blemish. Every stamp samples the ORIGINAL
 * (pre-heal) pixels — the GPU pass reads the source texture for all
 * stamps in one draw, and the CPU twin reads from a snapshot copy — so
 * stamp order only matters where destinations overlap.
 *
 * Coordinates: normalized to the framed image, ORIGIN TOP-LEFT (pointer
 * convention). The clone pass runs BEFORE the perspective warp, so its
 * coordinates stay valid and the healed result gets warped like any
 * other pixel. Distances are aspect-corrected (radius is a fraction of
 * image WIDTH; circles stay round on screen).
 */

import { clamp01, smoothstep } from './color-math';
import type { CloneStamp } from '../types';

/** Shader uniform arrays are fixed-size — the recipe cap. */
export const MAX_CLONE_STAMPS = 8;

export function isNeutralClones(clones: CloneStamp[] | undefined | null): boolean {
  return !clones || clones.length === 0;
}

export function defaultCloneStamp(u = 0.5, v = 0.5): CloneStamp {
  return {
    dstX: clamp01(u),
    dstY: clamp01(v),
    // Source defaults a little to the right (clamped) — visibly distinct
    // so the two handles never overlap on creation.
    srcX: clamp01(u + 0.15),
    srcY: clamp01(v),
    radius: 0.08,
    feather: 0.5,
  };
}

/** Feathered weight of a stamp's DESTINATION circle at (u, v). */
export function cloneWeight(
  stamp: CloneStamp,
  u: number,
  v: number,
  width: number,
  height: number
): number {
  const dx = u - stamp.dstX;
  const dy = (v - stamp.dstY) * (height / width); // width units
  const d = Math.sqrt(dx * dx + dy * dy) / Math.max(stamp.radius, 1e-4);
  if (d >= 1) return 0;
  return 1 - smoothstep(Math.max(0, 1 - stamp.feather), 1, d);
}

/** Move one handle of a stamp (clamped). Pure — the overlay's core. */
export function moveStampPoint(
  stamp: CloneStamp,
  which: 'src' | 'dst',
  u: number,
  v: number
): CloneStamp {
  return which === 'src'
    ? { ...stamp, srcX: clamp01(u), srcY: clamp01(v) }
    : { ...stamp, dstX: clamp01(u), dstY: clamp01(v) };
}

/**
 * CPU twin of the clone pass: heal RGBA bytes in place. All stamps sample
 * a SNAPSHOT of the input (matching the GPU's single-pass source reads),
 * mixed sequentially onto the working pixels.
 */
export function applyCloneStamps(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  stamps: CloneStamp[]
): void {
  if (stamps.length === 0) return;
  const src = data.slice();
  const sample = (fu: number, fv: number, c: number): number => {
    const fx = Math.min(width - 1, Math.max(0, fu * width - 0.5));
    const fy = Math.min(height - 1, Math.max(0, fv * height - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    return (
      src[(y0 * width + x0) * 4 + c] * (1 - tx) * (1 - ty) +
      src[(y0 * width + x1) * 4 + c] * tx * (1 - ty) +
      src[(y1 * width + x0) * 4 + c] * (1 - tx) * ty +
      src[(y1 * width + x1) * 4 + c] * tx * ty
    );
  };
  for (const stamp of stamps.slice(0, MAX_CLONE_STAMPS)) {
    const offU = stamp.srcX - stamp.dstX;
    const offV = stamp.srcY - stamp.dstY;
    // Destination bounding box in pixels (radius is a width fraction).
    const x0 = Math.max(0, Math.floor((stamp.dstX - stamp.radius) * width) - 1);
    const x1 = Math.min(width - 1, Math.ceil((stamp.dstX + stamp.radius) * width) + 1);
    const rV = (stamp.radius * width) / height;
    const y0 = Math.max(0, Math.floor((stamp.dstY - rV) * height) - 1);
    const y1 = Math.min(height - 1, Math.ceil((stamp.dstY + rV) * height) + 1);
    for (let py = y0; py <= y1; py++) {
      const v = (py + 0.5) / height;
      for (let px = x0; px <= x1; px++) {
        const u = (px + 0.5) / width;
        const w = cloneWeight(stamp, u, v, width, height);
        if (w <= 0) continue;
        const i = (py * width + px) * 4;
        for (let c = 0; c < 3; c++) {
          const healed = sample(clamp01(u + offU), clamp01(v + offV), c);
          data[i + c] = data[i + c] + (healed - data[i + c]) * w;
        }
      }
    }
  }
}
