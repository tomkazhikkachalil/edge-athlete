/**
 * Local adjustments via masks (Phase 2, round E4c) — PURE, node-tested.
 * Radial (ellipse) and linear (gradient) masks with ANALYTIC weights: no
 * mask textures at all — the shader evaluates the same closed-form
 * falloffs per pixel, so mask drags are pure uniform updates and stay in
 * the 60fps contract. (Brush masks, which DO need a painted texture, are
 * a later slice — the composite's input list is ready for them.)
 *
 * Coordinate convention: mask geometry is normalized to the FRAMED image
 * with ORIGIN TOP-LEFT (the UI/pointer convention). The engine flips y
 * when setting uniforms (its uv space is y-up); the CPU reference consumes
 * these values as-is against row coordinates.
 *
 * Per-mask adjustments deliberately compose as per-pixel SUMS of deltas
 * (EV, saturation, temperature), applied once — N masks cost one small
 * loop, not N pipeline passes, and overlapping masks blend sensibly.
 */

import { clamp01, luma709, smoothstep, WB_TEMP_SCALE, type Rgb } from './color-math';
import type { Mask, MaskAdjust } from '../types';

/** Shader uniform arrays are fixed-size — the recipe cap. */
export const MAX_MASKS = 4;
/** Local exposure ±1 → ±1 EV (gentler than the global ±2 EV). */
export const MASK_EV_RANGE = 1.0;

export const NEUTRAL_MASK_ADJUST: MaskAdjust = { exposure: 0, saturation: 0, temperature: 0 };

export function isNeutralMaskAdjust(adjust: MaskAdjust): boolean {
  return adjust.exposure === 0 && adjust.saturation === 0 && adjust.temperature === 0;
}

/** Masks are neutral when absent, empty, or every mask's adjust is zero —
 *  geometry alone changes nothing. */
export function isNeutralMasks(masks: Mask[] | undefined | null): boolean {
  if (!masks || masks.length === 0) return true;
  return masks.every(m => isNeutralMaskAdjust(m.adjust));
}

export function defaultRadialMask(): Mask {
  return {
    kind: 'radial',
    cx: 0.5,
    cy: 0.5,
    rx: 0.3,
    ry: 0.3,
    feather: 0.5,
    invert: false,
    adjust: { ...NEUTRAL_MASK_ADJUST },
  };
}

export function defaultLinearMask(): Mask {
  // Top-down gradient: full effect at the top edge, fading to none at the
  // vertical midpoint — the sky-darkening starting shape.
  return {
    kind: 'linear',
    x0: 0.5,
    y0: 0.1,
    x1: 0.5,
    y1: 0.55,
    adjust: { ...NEUTRAL_MASK_ADJUST },
  };
}

/**
 * Mask weight at normalized position (u, v), origin top-left. Radial:
 * 1 inside the feather-shrunk core, smoothstep to 0 at the ellipse edge
 * (invert flips). Linear: 1 at (x0,y0), fading to 0 at (x1,y1) along the
 * gradient axis (flat beyond either end).
 */
export function maskWeight(mask: Mask, u: number, v: number): number {
  if (mask.kind === 'radial') {
    const dx = (u - mask.cx) / Math.max(mask.rx, 1e-4);
    const dy = (v - mask.cy) / Math.max(mask.ry, 1e-4);
    const d = Math.sqrt(dx * dx + dy * dy);
    const inner = Math.max(0, 1 - mask.feather);
    const w = 1 - smoothstep(inner, 1, d);
    return mask.invert ? 1 - w : w;
  }
  const gx = mask.x1 - mask.x0;
  const gy = mask.y1 - mask.y0;
  const len2 = gx * gx + gy * gy;
  if (len2 < 1e-8) return 0;
  const t = ((u - mask.x0) * gx + (v - mask.y0) * gy) / len2;
  return 1 - smoothstep(0, 1, t);
}

/** Per-pixel local deltas: weighted sums over all masks. */
export function maskDeltas(
  masks: Mask[],
  u: number,
  v: number
): { ev: number; saturation: number; temperature: number } {
  let ev = 0;
  let saturation = 0;
  let temperature = 0;
  for (const mask of masks) {
    if (isNeutralMaskAdjust(mask.adjust)) continue;
    const w = maskWeight(mask, u, v);
    if (w <= 0) continue;
    ev += w * mask.adjust.exposure;
    saturation += w * mask.adjust.saturation;
    temperature += w * mask.adjust.temperature;
  }
  return { ev, saturation, temperature };
}

/** Apply the summed local deltas to one pixel — exposure (EV), then
 *  temperature (multiplicative WB), then saturation about Rec. 709 luma.
 *  The shader implements the same three lines with the same constants. */
export function applyMaskDeltas(
  rgb: Rgb,
  deltas: { ev: number; saturation: number; temperature: number }
): Rgb {
  let [r, g, b] = rgb;
  if (deltas.ev !== 0) {
    const m = Math.pow(2, deltas.ev * MASK_EV_RANGE);
    r *= m;
    g *= m;
    b *= m;
  }
  if (deltas.temperature !== 0) {
    r *= 1 + deltas.temperature * WB_TEMP_SCALE;
    b *= 1 - deltas.temperature * WB_TEMP_SCALE;
  }
  if (deltas.saturation !== 0) {
    const amount = Math.max(0, 1 + deltas.saturation);
    const L = luma709(r, g, b);
    r = L + (r - L) * amount;
    g = L + (g - L) * amount;
    b = L + (b - L) * amount;
  }
  return [r, g, b];
}

// ---- UI editing rules (pure, so the overlay stays thin) ----

export function moveMask(mask: Mask, du: number, dv: number): Mask {
  if (mask.kind === 'radial') {
    return { ...mask, cx: clamp01(mask.cx + du), cy: clamp01(mask.cy + dv) };
  }
  return {
    ...mask,
    x0: clamp01(mask.x0 + du),
    y0: clamp01(mask.y0 + dv),
    x1: clamp01(mask.x1 + du),
    y1: clamp01(mask.y1 + dv),
  };
}

export function moveLinearEndpoint(
  mask: Extract<Mask, { kind: 'linear' }>,
  endpoint: 0 | 1,
  u: number,
  v: number
): Mask {
  return endpoint === 0
    ? { ...mask, x0: clamp01(u), y0: clamp01(v) }
    : { ...mask, x1: clamp01(u), y1: clamp01(v) };
}
