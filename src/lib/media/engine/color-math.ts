/**
 * The color engine's formula surface — PURE, node-tested, and the single
 * source of truth for every constant. The GLSL in shaders.ts interpolates
 * THESE exports (a test asserts each constant appears verbatim in the
 * source), and reference.ts composes THESE functions, so the GPU preview,
 * the CPU export fallback, and the unit tests can never disagree on math.
 *
 * Working space: 0..1 floats per channel. Intermediates may leave 0..1 —
 * clamping happens ONCE at the end of the whole pipeline (same discipline as
 * the legacy applyAdjustments, which clamps only at the Uint8 write).
 *
 * Pipeline order (fixed; shader and reference must match):
 *   legacy trio → exposure → white balance → tone → vibrance → vignette
 */

import type { Adjustments, ColorAdjustments, LightAdjustments } from '../types';

export type Rgb = [number, number, number];

// ---- Constants (the tuning surface — change here, nowhere else) ----

/** Rec. 709 luma weights — masks and vibrance grayscale. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/** CSS Filter Effects saturate() matrix constants (Rec. 601-derived, per
 *  spec). MUST equal filters.ts SR/SG/SB — the legacy byte-parity contract. */
export const SAT_R = 0.213;
export const SAT_G = 0.715;
export const SAT_B = 0.072;

/** Exposure slider ±1 spans ±2 EV. */
export const EXPOSURE_EV_RANGE = 2.0;
/** Temperature ±1 → ±20% red/blue swing (multiplicative, clip-safe). */
export const WB_TEMP_SCALE = 0.2;
/** Tint ±1 → ∓15% green swing (+ = magenta, Lightroom convention). */
export const WB_TINT_SCALE = 0.15;
/** Highlights/shadows: max mid-mask luma shift. */
export const TONE_SCALE = 0.3;
/** Whites/blacks: max endpoint luma shift. */
export const TONE_POINT_SCALE = 0.25;
/** Vibrance ±1 → up to ±60% saturation on fully-unsaturated pixels. */
export const VIBRANCE_SCALE = 0.6;
/** Vignette falloff starts at this normalized center distance. */
export const VIGNETTE_INNER = 0.35;
/** Vignette ±1 → up to 80% darken / lighten at the corners. */
export const VIGNETTE_SCALE = 0.8;

// ---- Helpers ----

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** GLSL smoothstep semantics (t clamped, 3t²−2t³). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function luma709(r: number, g: number, b: number): number {
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

// ---- Pipeline stages ----

/** Legacy trio, CSS byte-parity: brightness multiply → contrast pivot 0.5
 *  (≡ 127.5/255) → CSS saturate matrix. Identical to applyAdjustments run
 *  in 0..1 space. */
export function applyLegacy([r, g, b]: Rgb, adj: Adjustments): Rgb {
  const { brightness: br, contrast: c, saturation: s } = adj;
  let nr = (r * br - 0.5) * c + 0.5;
  let ng = (g * br - 0.5) * c + 0.5;
  let nb = (b * br - 0.5) * c + 0.5;
  if (s !== 1) {
    const rr = (SAT_R + 0.787 * s) * nr + SAT_G * (1 - s) * ng + SAT_B * (1 - s) * nb;
    const gg = SAT_R * (1 - s) * nr + (SAT_G + 0.285 * s) * ng + SAT_B * (1 - s) * nb;
    const bb = SAT_R * (1 - s) * nr + SAT_G * (1 - s) * ng + (SAT_B + 0.928 * s) * nb;
    nr = rr;
    ng = gg;
    nb = bb;
  }
  return [nr, ng, nb];
}

export function applyExposure([r, g, b]: Rgb, exposure: number): Rgb {
  const m = Math.pow(2, exposure * EXPOSURE_EV_RANGE);
  return [r * m, g * m, b * m];
}

/** Multiplicative white balance — highlights don't clip asymmetrically. */
export function applyWhiteBalance([r, g, b]: Rgb, temperature: number, tint: number): Rgb {
  return [
    r * (1 + temperature * WB_TEMP_SCALE),
    g * (1 - tint * WB_TINT_SCALE),
    b * (1 - temperature * WB_TEMP_SCALE),
  ];
}

/**
 * Tone-range mapping, luma-masked. Highlights/shadows are RATIO-applied
 * (hue-preserving) with masks that vanish at the endpoints, so recovery can
 * never push white past white and shadow lift fades at pure black. Whites/
 * blacks are ADDITIVE achromatic offsets — they move the endpoints by
 * design (blacks + = the film-fade black-point lift). The dHS ratio is
 * guarded as 1 + dHS/max(L, ε): dHS ∝ L near zero, so the ratio stays
 * smooth and bounded instead of exploding.
 */
export function applyTone([r, g, b]: Rgb, light: LightAdjustments): Rgb {
  const L = clamp01(luma709(r, g, b));
  const dHS =
    light.highlights * TONE_SCALE * smoothstep(0.5, 1, L) * (1 - L) +
    light.shadows * TONE_SCALE * (1 - smoothstep(0, 0.5, L)) * L * (1 - L) * 2;
  const dWB =
    light.whites * TONE_POINT_SCALE * smoothstep(0.65, 1, L) +
    light.blacks * TONE_POINT_SCALE * (1 - smoothstep(0, 0.35, L));
  const ratio = 1 + dHS / Math.max(L, 1e-4);
  return [r * ratio + dWB, g * ratio + dWB, b * ratio + dWB];
}

/** Saturation weighted toward the LEAST saturated pixels (skin-safe pop). */
export function applyVibrance([r, g, b]: Rgb, vibrance: number): Rgb {
  const sat = clamp01(Math.max(r, g, b) - Math.min(r, g, b));
  const amount = 1 + vibrance * VIBRANCE_SCALE * (1 - sat);
  const L = luma709(r, g, b);
  return [L + (r - L) * amount, L + (g - L) * amount, L + (b - L) * amount];
}

/**
 * Falloff factor for the pixel at normalized position (u, v) in a w×h frame:
 * 0 inside VIGNETTE_INNER, → 1 at the corners (aspect-corrected ellipse).
 */
export function vignetteFalloff(u: number, v: number, width: number, height: number): number {
  const ay = height / width;
  const dx = u - 0.5;
  const dy = (v - 0.5) * ay;
  const corner = 0.5 * Math.sqrt(1 + ay * ay);
  const d = Math.sqrt(dx * dx + dy * dy) / corner;
  return smoothstep(VIGNETTE_INNER, 1, d);
}

/** + darkens toward black, − lightens toward white. `falloff` from above. */
export function applyVignette([r, g, b]: Rgb, vignette: number, falloff: number): Rgb {
  if (vignette >= 0) {
    const m = 1 - vignette * VIGNETTE_SCALE * falloff;
    return [r * m, g * m, b * m];
  }
  const t = -vignette * VIGNETTE_SCALE * falloff;
  return [r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t];
}

// ---- Composition ----

export interface ColorPipelineParams {
  adjustments: Adjustments;
  light: LightAdjustments;
  color: ColorAdjustments;
  vignette: number;
}

/** The full color pipeline for one pixel; `falloff` precomputed per pixel. */
export function transformPixel(rgb: Rgb, params: ColorPipelineParams, falloff: number): Rgb {
  let out = applyLegacy(rgb, params.adjustments);
  if (params.light.exposure !== 0) out = applyExposure(out, params.light.exposure);
  if (params.color.temperature !== 0 || params.color.tint !== 0) {
    out = applyWhiteBalance(out, params.color.temperature, params.color.tint);
  }
  const l = params.light;
  if (l.highlights !== 0 || l.shadows !== 0 || l.whites !== 0 || l.blacks !== 0) {
    out = applyTone(out, l);
  }
  if (params.color.vibrance !== 0) out = applyVibrance(out, params.color.vibrance);
  if (params.vignette !== 0) out = applyVignette(out, params.vignette, falloff);
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}
