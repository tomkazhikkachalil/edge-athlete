/**
 * Size/dimension planning for the canvas pipeline. Pure — unit-tested.
 */

/** iOS Safari corrupts canvases beyond ~4096px on a side / ~16.7M px area. */
export const MAX_CANVAS_DIM = 4096;

/** Live-preview texture cap: enough for any on-screen stage, uploads fast,
 *  and matches the common export cap so preview ≈ export resolution. */
export const PREVIEW_MAX_DIM = 2048;

export const MB = 1024 * 1024;

/** Fit w×h inside maxDim on the longest edge. Never upscales. */
export function fitWithin(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDim) return { width: Math.round(width), height: Math.round(height), scale: 1 };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Downscale plan: repeated halving until within 2× of the target, then the
 * exact target. Stepped halving preserves detail vs a single big drawImage
 * shrink (bilinear sampling loses quality beyond ~2×).
 */
export function downscaleSteps(
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number
): Array<{ width: number; height: number }> {
  const steps: Array<{ width: number; height: number }> = [];
  let w = fromWidth;
  let h = fromHeight;
  while (w / 2 > toWidth && h / 2 > toHeight) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    steps.push({ width: w, height: h });
  }
  steps.push({ width: toWidth, height: toHeight });
  return steps;
}
