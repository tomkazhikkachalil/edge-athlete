/**
 * Data-mask codec (Phase 3 scaffold) — PURE, node-tested. AI segmentation
 * (or any future raster source) lands in the recipe as a compact
 * run-length-encoded binary mask: recipes are JSONB and must stay small,
 * and real subject masks have very few runs (~2 per row → a few KB even
 * at 256²). This is the INGESTION format — it exists and is fully
 * exercised before any model runs anywhere, so plugging a runner in later
 * is data-only.
 *
 * Format: row-major bits, runs of alternating 0s/1s STARTING WITH ZEROS,
 * lengths joined by commas ("12,5,200,..."). Decode feathers the hard
 * edge with a small gaussian when asked — a hard-edged local adjustment
 * reads as a cutout, not an edit.
 */

import { gaussianKernel } from './color-math';
import type { Mask } from '../types';

/** Schema caps: mask rasters are model-resolution, never image-resolution. */
export const MAX_DATA_MASK_DIM = 512;
export const MAX_RLE_LENGTH = 20_000;

/** Feather slider ±? — a data mask's feather 0..1 maps to this σ range
 *  (in mask pixels) for the decode-time soften. */
export const DATA_MASK_FEATHER_SIGMA_MAX = 4;

/** Binary buffer (0/1 floats, row-major, origin top-left) → RLE string. */
export function encodeMaskRle(buffer: Float32Array, threshold = 0.5): string {
  const runs: number[] = [];
  let current = 0; // runs start with zeros by convention
  let length = 0;
  for (let i = 0; i < buffer.length; i++) {
    const bit = buffer[i] >= threshold ? 1 : 0;
    if (bit === current) {
      length++;
    } else {
      runs.push(length);
      current = bit;
      length = 1;
    }
  }
  runs.push(length);
  return runs.join(',');
}

/** RLE string → 0/1 float buffer. Null on malformed input or a size
 *  mismatch — callers treat that as "no mask". */
export function decodeMaskRle(
  rle: string,
  width: number,
  height: number
): Float32Array | null {
  if (rle.length === 0 || rle.length > MAX_RLE_LENGTH) return null;
  const total = width * height;
  const buffer = new Float32Array(total);
  let position = 0;
  let value = 0;
  for (const part of rle.split(',')) {
    const run = Number(part);
    if (!Number.isInteger(run) || run < 0) return null;
    if (position + run > total) return null;
    if (value === 1) buffer.fill(1, position, position + run);
    position += run;
    value = 1 - value;
  }
  return position === total ? buffer : null;
}

/** Decode + feather + invert a data mask into a sampleable coverage
 *  buffer (the shape mask-math/engine consume, same as brush buffers).
 *  Null on malformed RLE — the mask degrades to zero weight. */
export function dataMaskBuffer(
  mask: Extract<Mask, { kind: 'data' }>
): { buffer: Float32Array; width: number; height: number } | null {
  const decoded = decodeMaskRle(mask.rle, mask.width, mask.height);
  if (!decoded) return null;
  let buffer = featherMaskBuffer(decoded, mask.width, mask.height, mask.feather);
  if (mask.invert) {
    const inverted = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) inverted[i] = 1 - buffer[i];
    buffer = inverted;
  }
  return { buffer, width: mask.width, height: mask.height };
}

/** Single-channel separable gaussian soften (decode-time feathering).
 *  σ derives from feather 0..1; feather 0 returns the input untouched. */
export function featherMaskBuffer(
  buffer: Float32Array,
  width: number,
  height: number,
  feather: number
): Float32Array {
  if (feather <= 0) return buffer;
  const sigma = Math.max(0.5, feather * DATA_MASK_FEATHER_SIGMA_MAX);
  const taps = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
  const kernel = gaussianKernel(sigma, taps);
  const half = kernel.length - 1;
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y);
  const horizontal = new Float32Array(buffer.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -half; k <= half; k++) {
        acc += buffer[y * width + clampX(x + k)] * kernel[Math.abs(k)];
      }
      horizontal[y * width + x] = acc;
    }
  }
  const out = new Float32Array(buffer.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -half; k <= half; k++) {
        acc += horizontal[clampY(y + k) * width + x] * kernel[Math.abs(k)];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}
