/**
 * Film grain (Phase 2, round E4d) — PURE, node-tested. Procedural
 * monochrome grain: white noise per grain cell (size in device pixels),
 * midtone-weighted (real film grain lives in the midtones; deep shadows
 * and highlights stay cleaner), applied AFTER vignette as the last look
 * stage before the output dither.
 *
 * Parity note, stated honestly: the GPU uses the classic fract(sin(...))
 * hash and GPU sin precision differs across drivers, so grain is
 * PER-PIXEL DIFFERENT between GPU preview/export and this CPU twin. That
 * is fine by design — grain is a stochastic texture; its parity contract
 * is statistical (same amplitude, same weighting, zero mean), which the
 * tests pin. Everything deterministic stays byte-comparable elsewhere.
 */

import { clamp01, luma709, type Rgb } from './color-math';
import type { GrainSettings } from '../types';

/** Full-amount grain amplitude (± half of this around zero). */
export const GRAIN_SCALE = 0.25;
/** Base + midtone split of the luma weighting. */
export const GRAIN_BASE_WEIGHT = 0.35;
export const GRAIN_MID_WEIGHT = 0.65;
/** Grain cell size bounds, device pixels. */
export const GRAIN_SIZE_MIN = 1;
export const GRAIN_SIZE_MAX = 3;

export function isNeutralGrain(grain: GrainSettings | undefined | null): boolean {
  return !grain || grain.amount === 0;
}

/** Deterministic cell hash → −0.5..0.5 (the CPU stand-in for the GLSL
 *  fract(sin) hash — same distribution, different sequence). */
export function grainNoise(cellX: number, cellY: number): number {
  let h = (Math.imul(cellX, 374761393) + Math.imul(cellY, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  // Unsigned 0..1 → centered.
  return ((h >>> 0) / 4294967295) - 0.5;
}

/** Midtone-heavy amplitude for a pixel's luma. */
export function grainWeight(luma: number): number {
  const l = clamp01(luma);
  return GRAIN_BASE_WEIGHT + GRAIN_MID_WEIGHT * 4 * l * (1 - l);
}

/** Apply grain to one pixel at device coords (px, py). Input is expected
 *  post-vignette; output may leave [0,1] and clamps at the byte write. */
export function applyGrain(rgb: Rgb, px: number, py: number, grain: GrainSettings): Rgb {
  const size = Math.min(GRAIN_SIZE_MAX, Math.max(GRAIN_SIZE_MIN, grain.size));
  const n = grainNoise(Math.floor(px / size), Math.floor(py / size));
  const L = luma709(clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]));
  const delta = n * grain.amount * GRAIN_SCALE * grainWeight(L);
  return [rgb[0] + delta, rgb[1] + delta, rgb[2] + delta];
}
