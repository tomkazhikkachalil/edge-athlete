import { describe, it, expect } from 'vitest';
import {
  hasAdvancedParams,
  isEngineNeutral,
  NEUTRAL_ENGINE_PARAMS,
  planPasses,
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

  it('film presets add their engine components, scaled by strength', () => {
    const full = recipeToEngineParams({ ...defaultImageRecipe(), filterId: 'gold' });
    expect(full.light.exposure).toBeCloseTo(0.05);
    expect(full.light.highlights).toBeCloseTo(-0.15);
    expect(full.color.temperature).toBeCloseTo(0.3);
    expect(full.color.vibrance).toBeCloseTo(0.2);
    expect(hasAdvancedParams(full)).toBe(true); // film looks need the engine
    const half = recipeToEngineParams({
      ...defaultImageRecipe(),
      filterId: 'gold',
      filterStrength: 0.5,
    });
    expect(half.color.temperature).toBeCloseTo(0.15);
  });

  it('preset + user components clamp to the schema range', () => {
    const base = defaultImageRecipe();
    const params = recipeToEngineParams({
      ...base,
      filterId: 'gold', // temperature +0.3
      color: { ...base.color, temperature: 0.9 },
    });
    expect(params.color.temperature).toBe(1);
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

  it('planPasses skips every blur when detail is neutral (the 1-pass drag contract)', () => {
    expect(planPasses(NEUTRAL_ENGINE_PARAMS)).toEqual({ blurSmall: false, blurLarge: false });
    const base = NEUTRAL_ENGINE_PARAMS;
    expect(
      planPasses({ ...base, light: { ...base.light, exposure: 0.5 } })
    ).toEqual({ blurSmall: false, blurLarge: false });
    expect(planPasses({ ...base, detail: { ...base.detail, sharpen: 0.5 } })).toEqual({
      blurSmall: true,
      blurLarge: false,
    });
    expect(planPasses({ ...base, detail: { ...base.detail, clarity: 0.5 } })).toEqual({
      blurSmall: false,
      blurLarge: true,
    });
    expect(planPasses({ ...base, detail: { ...base.detail, noiseReduction: 0.5 } })).toEqual({
      blurSmall: false,
      blurLarge: true,
    });
    // Vignette needs no blur input at all.
    expect(planPasses({ ...base, detail: { ...base.detail, vignette: 1 } })).toEqual({
      blurSmall: false,
      blurLarge: false,
    });
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

  it('hsl routes to the engine; sparse recipes normalize to all-band mixes', () => {
    const base = defaultImageRecipe();
    const params = recipeToEngineParams({
      ...base,
      hsl: { aqua: { hue: 0, saturation: 0, luminance: -0.6 } },
    });
    expect(params.hsl.aqua.luminance).toBe(-0.6);
    expect(params.hsl.red).toEqual({ hue: 0, saturation: 0, luminance: 0 });
    expect(hasAdvancedParams(params)).toBe(true);
    // Zeroed bands stay non-advanced.
    expect(
      hasAdvancedParams(
        recipeToEngineParams({ ...base, hsl: { red: { hue: 0, saturation: 0, luminance: 0 } } })
      )
    ).toBe(false);
  });

  it('perspective routes to the engine; absent maps to neutral', () => {
    const base = defaultImageRecipe();
    expect(recipeToEngineParams(base).perspective).toEqual({ vertical: 0, horizontal: 0 });
    const warped = recipeToEngineParams({
      ...base,
      perspective: { vertical: 0.4, horizontal: 0 },
    });
    expect(warped.perspective.vertical).toBe(0.4);
    expect(hasAdvancedParams(warped)).toBe(true);
  });
});
