import { describe, it, expect } from 'vitest';
import {
  hasAdvancedParams,
  isEngineNeutral,
  NEUTRAL_ENGINE_PARAMS,
  recipeToEngineParams,
  scaledPresetAdjustments,
} from '../params';
import { defaultImageRecipe } from '../../recipes';
import { composeAdjustments } from '../../filters';

describe('recipeToEngineParams', () => {
  it('a default recipe maps to neutral params', () => {
    const params = recipeToEngineParams(defaultImageRecipe());
    expect(params).toEqual(NEUTRAL_ENGINE_PARAMS);
    expect(isEngineNeutral(params)).toBe(true);
    expect(hasAdvancedParams(params)).toBe(false);
  });

  it('full-strength presets compose exactly like the v2 pipeline', () => {
    const recipe = { ...defaultImageRecipe(), filterId: 'punch' };
    expect(recipeToEngineParams(recipe).adjustments).toEqual(
      composeAdjustments(recipe.adjustments, 'punch')
    );
  });

  it('filterStrength lerps the preset toward neutral', () => {
    // punch: contrast 1.25 / saturation 1.35 → at 0.5: 1.125 / 1.175
    const half = recipeToEngineParams({
      ...defaultImageRecipe(),
      filterId: 'punch',
      filterStrength: 0.5,
    });
    expect(half.adjustments.contrast).toBeCloseTo(1.125);
    expect(half.adjustments.saturation).toBeCloseTo(1.175);
    const off = recipeToEngineParams({
      ...defaultImageRecipe(),
      filterId: 'punch',
      filterStrength: 0,
    });
    expect(off.adjustments).toEqual(NEUTRAL_ENGINE_PARAMS.adjustments);
  });

  it('scaledPresetAdjustments is neutral for null/unknown filters', () => {
    expect(scaledPresetAdjustments(null, 1)).toEqual(NEUTRAL_ENGINE_PARAMS.adjustments);
    expect(scaledPresetAdjustments('no-such-filter', 0.5)).toEqual(
      NEUTRAL_ENGINE_PARAMS.adjustments
    );
  });
});

describe('advanced-params routing (engine vs legacy fast path)', () => {
  it('legacy-trio-only edits are NOT advanced — they keep the ctx.filter path', () => {
    const recipe = {
      ...defaultImageRecipe(),
      adjustments: { brightness: 1.3, contrast: 0.9, saturation: 1.2 },
      filterId: 'warm',
    };
    expect(hasAdvancedParams(recipeToEngineParams(recipe))).toBe(false);
  });

  it('any light/color/detail value routes to the engine', () => {
    const base = defaultImageRecipe();
    expect(
      hasAdvancedParams(recipeToEngineParams({ ...base, light: { ...base.light, exposure: 0.1 } }))
    ).toBe(true);
    expect(
      hasAdvancedParams(recipeToEngineParams({ ...base, color: { ...base.color, vibrance: -0.2 } }))
    ).toBe(true);
    expect(
      hasAdvancedParams(recipeToEngineParams({ ...base, detail: { ...base.detail, vignette: 0.5 } }))
    ).toBe(true);
  });
});
