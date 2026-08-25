/**
 * HSL color mixer (Phase 2, round E4a) — PURE, node-tested, and the single
 * source for every mixer constant. Eight hue bands (the Lightroom set),
 * each with hue/saturation/luminance sliders, baked into a 256-bin LUT:
 *   bin = hue → (encoded hue shift, sat multiplier, lum multiplier)
 * The SAME baked bytes feed the GPU (256×1 RGBA texture, linear-sampled)
 * and the CPU reference (linear interpolation below) — parity by
 * construction, not by parallel implementations.
 *
 * Application model per pixel (shader mirrors exactly):
 *   clamp rgb → HSL → look up by hue → shift hue (wrap), scale sat/lum →
 *   RGB, then blend toward the untouched pixel by the gray guard
 *   (smoothstep of original saturation) so near-grays with noisy hue are
 *   never mangled.
 */

import { clamp01, smoothstep, type Rgb } from './color-math';
import type { HslBandAdjust, HslBandName, HslMix } from '../types';

// ---- Bands (order matters: adjacent centers interpolate) ----

export const HSL_BAND_NAMES: HslBandName[] = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
];

/** Band hue centers in degrees, ascending (red wraps at 0/360). */
export const HSL_BAND_CENTERS: number[] = [0, 30, 60, 120, 180, 240, 280, 320];

// ---- Slider ranges (the tuning surface) ----

/** Hue slider ±1 → ±45° shift. */
export const HSL_HUE_RANGE_DEG = 45;
/** Saturation slider ±1 → ×(1 ± 0.6). */
export const HSL_SAT_RANGE = 0.6;
/** Luminance slider ±1 → ×(1 ± 0.4). */
export const HSL_LUM_RANGE = 0.4;
/** Pixels below this original saturation are progressively protected. */
export const HSL_GRAY_GUARD = 0.2;

export const HSL_LUT_SIZE = 256;

export const NEUTRAL_BAND: HslBandAdjust = { hue: 0, saturation: 0, luminance: 0 };

export function neutralHslMix(): HslMix {
  const mix = {} as HslMix;
  for (const name of HSL_BAND_NAMES) mix[name] = { ...NEUTRAL_BAND };
  return mix;
}

export function isNeutralHsl(
  mix: Partial<Record<HslBandName, HslBandAdjust>> | undefined | null
): boolean {
  if (!mix) return true;
  return Object.values(mix).every(
    band => !band || (band.hue === 0 && band.saturation === 0 && band.luminance === 0)
  );
}

/** Recipe (sparse) → full mix with zeros for absent bands. */
export function normalizeHslMix(
  mix: Partial<Record<HslBandName, HslBandAdjust>> | undefined
): HslMix {
  const full = neutralHslMix();
  if (!mix) return full;
  for (const name of HSL_BAND_NAMES) {
    const band = mix[name];
    if (band) full[name] = { ...band };
  }
  return full;
}

// ---- LUT bake ----

/** Aggregate band adjustments at a hue (degrees): each hue lies between two
 *  adjacent band centers and smoothstep-lerps their values — a partition of
 *  unity, continuous across the red wrap. */
export function hslAdjustAtHue(hueDeg: number, mix: HslMix): HslBandAdjust {
  const h = ((hueDeg % 360) + 360) % 360;
  const n = HSL_BAND_CENTERS.length;
  for (let i = 0; i < n; i++) {
    const c0 = HSL_BAND_CENTERS[i];
    const c1 = i + 1 < n ? HSL_BAND_CENTERS[i + 1] : HSL_BAND_CENTERS[0] + 360;
    const hh = h < c0 ? h + 360 : h; // wrap segment (magenta→red)
    if (hh >= c0 && hh < c1) {
      const t = smoothstep(0, 1, (hh - c0) / (c1 - c0));
      const a = mix[HSL_BAND_NAMES[i]];
      const b = mix[HSL_BAND_NAMES[(i + 1) % n]];
      return {
        hue: a.hue + (b.hue - a.hue) * t,
        saturation: a.saturation + (b.saturation - a.saturation) * t,
        luminance: a.luminance + (b.luminance - a.luminance) * t,
      };
    }
  }
  return { ...NEUTRAL_BAND }; // unreachable
}

// Symmetric-zero byte encoding: 128 decodes to EXACTLY 0, so a neutral
// band bakes a true identity (the naive (v+1)/2·255 scheme puts zero at
// 127.5 and every "neutral" LUT would nudge colors by half a step).
const encodeSigned = (v: number): number =>
  Math.min(255, Math.round(Math.max(-1, Math.min(1, v)) * 127.5 + 128));
const decodeSigned = (byte: number): number => (byte - 128) / 127.5;

/** 256 RGBA bytes: r = hue shift, g = sat, b = lum (signed-encoded), a=255.
 *  Uploaded verbatim as the GPU LUT and consumed verbatim by the CPU path. */
export function bakeHslLut(mix: HslMix): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(HSL_LUT_SIZE * 4);
  for (let bin = 0; bin < HSL_LUT_SIZE; bin++) {
    const adj = hslAdjustAtHue((bin / HSL_LUT_SIZE) * 360, mix);
    lut[bin * 4] = encodeSigned(adj.hue);
    lut[bin * 4 + 1] = encodeSigned(adj.saturation);
    lut[bin * 4 + 2] = encodeSigned(adj.luminance);
    lut[bin * 4 + 3] = 255;
  }
  return lut;
}

// ---- Color space (matching the GLSL implementations) ----

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1) + 1e-6);
  let h: number;
  if (mx === r) h = ((g - b) / d + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: Rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

// ---- CPU application (the reference/export-fallback path) ----

/** Linear LUT fetch at a fractional hue — the CPU twin of the GPU's
 *  LINEAR sample at (h·255 + 0.5)/256. */
function sampleLut(lut: Uint8ClampedArray, hue: number, channel: number): number {
  const pos = hue * (HSL_LUT_SIZE - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(HSL_LUT_SIZE - 1, i0 + 1);
  const t = pos - i0;
  const v = lut[i0 * 4 + channel] * (1 - t) + lut[i1 * 4 + channel] * t;
  return decodeSigned(v);
}

/** Apply the baked mixer to one pixel. Input is clamped internally; output
 *  is in [0,1] (the HSL domain is closed). */
export function applyHslLut(rgb: Rgb, lut: Uint8ClampedArray): Rgb {
  const r = clamp01(rgb[0]);
  const g = clamp01(rgb[1]);
  const b = clamp01(rgb[2]);
  const [h, s, l] = rgbToHsl(r, g, b);
  const guard = smoothstep(0, HSL_GRAY_GUARD, s);
  if (guard === 0) return [r, g, b];
  const hueShift = sampleLut(lut, h, 0) * (HSL_HUE_RANGE_DEG / 360);
  const satMul = 1 + sampleLut(lut, h, 1) * HSL_SAT_RANGE;
  const lumMul = 1 + sampleLut(lut, h, 2) * HSL_LUM_RANGE;
  const [nr, ng, nb] = hslToRgb(h + hueShift, clamp01(s * satMul), clamp01(l * lumMul));
  return [r + (nr - r) * guard, g + (ng - g) * guard, b + (nb - b) * guard];
}
