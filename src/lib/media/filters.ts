/**
 * Adjustments + preset filters — the pure reference implementation.
 *
 * Live preview uses cssFilterString() (GPU, every browser incl. Safari).
 * Export uses ctx.filter where supported, else applyAdjustments() on raw
 * pixels. Both paths implement the SAME CSS Filter Effects math (brightness
 * multiply → contrast pivot 127.5 → saturate luma matrix, in that order), so
 * preview and output can never disagree. Presets are constrained to what the
 * pixel path implements — no blur/vignette in v1.
 */

import type { Adjustments, ColorAdjustments, DetailAdjustments, LightAdjustments } from './types';

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
};

export function isNeutral(adj: Adjustments): boolean {
  return adj.brightness === 1 && adj.contrast === 1 && adj.saturation === 1;
}

// Engine-round groups (recipe v3) — all zero-neutral, so neutrality is
// "every value is 0" and the v2 → v3 upgrade is a spread plus these.
export const NEUTRAL_LIGHT: LightAdjustments = {
  exposure: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
};

export const NEUTRAL_COLOR: ColorAdjustments = {
  temperature: 0,
  tint: 0,
  vibrance: 0,
};

export const NEUTRAL_DETAIL: DetailAdjustments = {
  sharpen: 0,
  clarity: 0,
  noiseReduction: 0,
  vignette: 0,
};

function allZero(group: object): boolean {
  return Object.values(group).every(v => v === 0);
}

export function isNeutralLight(light: LightAdjustments): boolean {
  return allZero(light);
}

export function isNeutralColor(color: ColorAdjustments): boolean {
  return allZero(color);
}

export function isNeutralDetail(detail: DetailAdjustments): boolean {
  return allZero(detail);
}

export interface FilterPreset {
  id: string;
  label: string;
  adjustments: Adjustments;
}

export const PRESET_FILTERS: FilterPreset[] = [
  { id: 'crisp', label: 'Crisp', adjustments: { brightness: 1.05, contrast: 1.15, saturation: 1.1 } },
  { id: 'warm', label: 'Warm', adjustments: { brightness: 1.08, contrast: 1.02, saturation: 1.25 } },
  { id: 'fade', label: 'Fade', adjustments: { brightness: 1.1, contrast: 0.85, saturation: 0.75 } },
  { id: 'punch', label: 'Punch', adjustments: { brightness: 1, contrast: 1.25, saturation: 1.35 } },
  { id: 'mono', label: 'Mono', adjustments: { brightness: 1, contrast: 1.05, saturation: 0 } },
];

export function getPreset(filterId: string | null): FilterPreset | null {
  if (!filterId) return null;
  return PRESET_FILTERS.find(p => p.id === filterId) ?? null;
}

/**
 * User adjustments composed with a preset (multiplicative — an approximation
 * of sequential application, close enough for preset strengths ≤1.35 and
 * keeps both paths a single three-value pipeline).
 */
export function composeAdjustments(user: Adjustments, filterId: string | null): Adjustments {
  const preset = getPreset(filterId);
  if (!preset) return user;
  return {
    brightness: user.brightness * preset.adjustments.brightness,
    contrast: user.contrast * preset.adjustments.contrast,
    saturation: user.saturation * preset.adjustments.saturation,
  };
}

/** CSS filter string for live preview; '' when neutral (lets the GPU skip). */
export function cssFilterString(adj: Adjustments): string {
  if (isNeutral(adj)) return '';
  return `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturation})`;
}

// CSS Filter Effects saturate() matrix constants (Rec. 601-derived, per spec)
const SR = 0.213;
const SG = 0.715;
const SB = 0.072;

/**
 * Apply adjustments in place to RGBA pixel data (same math + order as the
 * CSS filter string). Uint8ClampedArray so it's testable in Node (no
 * ImageData there); clamping is the array's own semantics on write.
 */
export function applyAdjustments(data: Uint8ClampedArray, adj: Adjustments): void {
  if (isNeutral(adj)) return;
  const { brightness: b, contrast: c, saturation: s } = adj;
  const applySat = s !== 1;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * b;
    let g = data[i + 1] * b;
    let bl = data[i + 2] * b;

    r = (r - 127.5) * c + 127.5;
    g = (g - 127.5) * c + 127.5;
    bl = (bl - 127.5) * c + 127.5;

    if (applySat) {
      const nr = (SR + 0.787 * s) * r + SG * (1 - s) * g + SB * (1 - s) * bl;
      const ng = SR * (1 - s) * r + (SG + 0.285 * s) * g + SB * (1 - s) * bl;
      const nb = SR * (1 - s) * r + SG * (1 - s) * g + (SB + 0.928 * s) * bl;
      r = nr;
      g = ng;
      bl = nb;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = bl;
  }
}
