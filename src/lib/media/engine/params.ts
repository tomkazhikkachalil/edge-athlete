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
}

export const NEUTRAL_ENGINE_PARAMS: EngineParams = {
  adjustments: NEUTRAL_ADJUSTMENTS,
  light: NEUTRAL_LIGHT,
  color: NEUTRAL_COLOR,
  detail: NEUTRAL_DETAIL,
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
  return {
    adjustments,
    light: { ...recipe.light },
    color: { ...recipe.color },
    detail: { ...recipe.detail },
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
    !isNeutralDetail(params.detail)
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
