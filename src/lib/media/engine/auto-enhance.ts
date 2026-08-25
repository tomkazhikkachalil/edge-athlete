/**
 * Auto-enhance — PURE, node-tested. Classic percentile targeting over a
 * luma histogram: nudge exposure so the median approaches a pleasant mid,
 * stretch blacks/whites toward gentle endpoints, add a mild contrast bump
 * for flat histograms. Deliberately conservative — this is "one tap makes
 * it better", not a look; every output is a normal recipe patch the user
 * can see on the sliders, tweak, or undo as ONE step.
 */

import { EXPOSURE_EV_RANGE, luma709, smoothstep, TONE_POINT_SCALE } from './color-math';
import type { Adjustments, LightAdjustments } from '../types';

/** Where the 0.5th / 99.5th percentile and median should land (0..1). */
export const AUTO_BLACK_TARGET = 0.02;
export const AUTO_WHITE_TARGET = 0.98;
export const AUTO_MID_TARGET = 0.45;
/** Exposure correction is clamped to ±0.5 EV — auto never relights a scene. */
export const AUTO_EV_CLAMP = 0.5;
/** Flat histograms get up to this much extra contrast. */
export const AUTO_CONTRAST_MAX_BUMP = 0.08;

export interface AutoEnhancePatch {
  light: Pick<LightAdjustments, 'exposure' | 'whites' | 'blacks'>;
  contrast: Adjustments['contrast'];
}

/** Luma value (0..255 bin) at cumulative fraction `q` of a 256-bin histogram. */
export function percentile(histogram: Uint32Array, q: number): number {
  let total = 0;
  for (let i = 0; i < histogram.length; i++) total += histogram[i];
  if (total === 0) return 0;
  const threshold = total * q;
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i];
    if (cumulative >= threshold) return i;
  }
  return histogram.length - 1;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function autoEnhance(histogram: Uint32Array): AutoEnhancePatch {
  const lo = percentile(histogram, 0.005) / 255;
  const hi = percentile(histogram, 0.995) / 255;
  const mid = percentile(histogram, 0.5) / 255;

  // Median → mid target, in EV, clamped, expressed in slider units (±1 =
  // ±EXPOSURE_EV_RANGE EV — the same mapping the engine applies).
  const ev = clamp(Math.log2(AUTO_MID_TARGET / Math.max(mid, 0.01)), -AUTO_EV_CLAMP, AUTO_EV_CLAMP);
  const exposure = ev / EXPOSURE_EV_RANGE;

  // Whites/blacks: invert the tone stage's additive endpoint terms so the
  // percentile lands on its target. Masks vanishing means "no pixels that
  // slider could move" — output 0 rather than dividing by ~0.
  const blackMask = 1 - smoothstep(0, 0.35, lo);
  const blacks =
    blackMask < 0.05 ? 0 : clamp((AUTO_BLACK_TARGET - lo) / (TONE_POINT_SCALE * blackMask), -1, 1);
  const whiteMask = smoothstep(0.65, 1, hi);
  const whites =
    whiteMask < 0.05 ? 0 : clamp((AUTO_WHITE_TARGET - hi) / (TONE_POINT_SCALE * whiteMask), -1, 1);

  // Mild contrast for flat histograms (small spread → bigger bump).
  const contrast = 1 + AUTO_CONTRAST_MAX_BUMP * clamp(1 - (hi - lo), 0, 1);

  return { light: { exposure, whites, blacks }, contrast };
}

/** Rec. 709 luma histogram of RGBA bytes — pure so tests can feed it. */
export function computeHistogram(data: Uint8ClampedArray): Uint32Array {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const luma = luma709(data[i], data[i + 1], data[i + 2]);
    histogram[Math.min(255, Math.round(luma))]++;
  }
  return histogram;
}
