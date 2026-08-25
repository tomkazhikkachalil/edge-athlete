/**
 * Recipe → engine parameters. PURE, node-tested.
 *
 * EngineParams is what both renderers consume: the GPU pass (uniforms) and
 * the CPU reference (pixel loop). The legacy trio arrives here already
 * COMPOSED with the active preset (scaled by filterStrength), so downstream
 * there is exactly one Adjustments value — same collapsing the old pipeline
 * did via composeAdjustments.
 */

import {
  composeAdjustments,
  getPreset,
  isNeutral,
  isNeutralColor,
  isNeutralDetail,
  isNeutralLight,
  NEUTRAL_ADJUSTMENTS,
  NEUTRAL_COLOR,
  NEUTRAL_DETAIL,
  NEUTRAL_LIGHT,
} from '../filters';
import {
  isNeutralPerspective,
  NEUTRAL_PERSPECTIVE,
  type PerspectiveParams,
} from './perspective-math';
import { isNeutralHsl, neutralHslMix, normalizeHslMix } from './hsl-math';
import { isNeutralCurves } from './curves-math';
import { isNeutralMasks } from './mask-math';
import type { CurveSet, HslMix, Mask } from '../types';
import type {
  Adjustments,
  ColorAdjustments,
  DetailAdjustments,
  ImageRecipe,
  LightAdjustments,
} from '../types';

export interface EngineParams {
  /** Composed legacy trio (user × strength-scaled preset), 1-neutral. */
  adjustments: Adjustments;
  light: LightAdjustments;
  color: ColorAdjustments;
  detail: DetailAdjustments;
  perspective: PerspectiveParams;
  /** Normalized (all bands present); neutralHslMix() when the recipe has none. */
  hsl: HslMix;
  /** Tone curves; empty object = identity. */
  curves: CurveSet;
  /** Local-adjustment masks; [] = none. */
  masks: Mask[];
}

export const NEUTRAL_ENGINE_PARAMS: EngineParams = {
  adjustments: NEUTRAL_ADJUSTMENTS,
  light: NEUTRAL_LIGHT,
  color: NEUTRAL_COLOR,
  detail: NEUTRAL_DETAIL,
  perspective: NEUTRAL_PERSPECTIVE,
  hsl: neutralHslMix(),
  curves: {},
  masks: [],
};

/** Preset lerped toward neutral by strength (0 = off, 1 = full preset). */
export function scaledPresetAdjustments(
  filterId: string | null,
  strength: number
): Adjustments {
  const preset = getPreset(filterId);
  if (!preset || strength >= 1) return preset?.adjustments ?? NEUTRAL_ADJUSTMENTS;
  const s = Math.max(0, strength);
  return {
    brightness: 1 + (preset.adjustments.brightness - 1) * s,
    contrast: 1 + (preset.adjustments.contrast - 1) * s,
    saturation: 1 + (preset.adjustments.saturation - 1) * s,
  };
}

const clampSigned = (v: number) => Math.max(-1, Math.min(1, v));
const clampUnsigned = (v: number) => Math.max(0, Math.min(1, v));

export function recipeToEngineParams(recipe: ImageRecipe): EngineParams {
  let adjustments: Adjustments;
  if (recipe.filterStrength >= 1) {
    adjustments = composeAdjustments(recipe.adjustments, recipe.filterId);
  } else {
    const preset = scaledPresetAdjustments(recipe.filterId, recipe.filterStrength);
    adjustments = {
      brightness: recipe.adjustments.brightness * preset.brightness,
      contrast: recipe.adjustments.contrast * preset.contrast,
      saturation: recipe.adjustments.saturation * preset.saturation,
    };
  }
  // Film-pack presets carry engine-group components: additive (the groups
  // are zero-neutral), scaled by strength, clamped to each field's range so
  // preset + user can never leave the schema domain.
  const preset = getPreset(recipe.filterId);
  const s = clampUnsigned(recipe.filterStrength);
  const pl = preset?.light;
  const pc = preset?.color;
  const pd = preset?.detail;
  return {
    adjustments,
    light: {
      exposure: clampSigned(recipe.light.exposure + (pl?.exposure ?? 0) * s),
      highlights: clampSigned(recipe.light.highlights + (pl?.highlights ?? 0) * s),
      shadows: clampSigned(recipe.light.shadows + (pl?.shadows ?? 0) * s),
      whites: clampSigned(recipe.light.whites + (pl?.whites ?? 0) * s),
      blacks: clampSigned(recipe.light.blacks + (pl?.blacks ?? 0) * s),
    },
    color: {
      temperature: clampSigned(recipe.color.temperature + (pc?.temperature ?? 0) * s),
      tint: clampSigned(recipe.color.tint + (pc?.tint ?? 0) * s),
      vibrance: clampSigned(recipe.color.vibrance + (pc?.vibrance ?? 0) * s),
    },
    detail: {
      sharpen: clampUnsigned(recipe.detail.sharpen + (pd?.sharpen ?? 0) * s),
      clarity: clampUnsigned(recipe.detail.clarity + (pd?.clarity ?? 0) * s),
      noiseReduction: clampUnsigned(recipe.detail.noiseReduction + (pd?.noiseReduction ?? 0) * s),
      vignette: clampSigned(recipe.detail.vignette + (pd?.vignette ?? 0) * s),
    },
    perspective: recipe.perspective ? { ...recipe.perspective } : { ...NEUTRAL_PERSPECTIVE },
    hsl: normalizeHslMix(recipe.hsl),
    curves: recipe.curves ? { ...recipe.curves } : {},
    masks: recipe.masks ? recipe.masks.map(m => ({ ...m, adjust: { ...m.adjust } })) : [],
  };
}

/**
 * True when the recipe needs the ENGINE (WebGL / reference pixel loop) —
 * anything the legacy CSS-filter path cannot express. Legacy-trio-only
 * recipes keep the existing ctx.filter / applyAdjustments fast path.
 */
export function hasAdvancedParams(params: EngineParams): boolean {
  return (
    !isNeutralLight(params.light) ||
    !isNeutralColor(params.color) ||
    !isNeutralDetail(params.detail) ||
    !isNeutralPerspective(params.perspective) ||
    !isNeutralHsl(params.hsl) ||
    !isNeutralCurves(params.curves) ||
    !isNeutralMasks(params.masks)
  );
}

export function isEngineNeutral(params: EngineParams): boolean {
  return isNeutral(params.adjustments) && !hasAdvancedParams(params);
}

/**
 * Which blur inputs the composite pass needs. Skip-when-neutral is the
 * perf contract: a Light/Color slider drag stays a single fullscreen pass;
 * blur passes run only while a detail slider is actually non-zero (and the
 * engine caches them per source, so even then drags stay uniform-only).
 */
export function planPasses(params: EngineParams): { blurSmall: boolean; blurLarge: boolean } {
  return {
    blurSmall: params.detail.sharpen > 0,
    blurLarge: params.detail.clarity > 0 || params.detail.noiseReduction > 0,
  };
}
