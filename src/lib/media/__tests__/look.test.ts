import { describe, it, expect } from 'vitest';
import { applyLook, extractLook, isNeutralLook, lookSchema, lookToPatch } from '../look';
import { defaultImageRecipe, isNoopRecipe, parseRecipe, serializeRecipe } from '../recipes';
import type { ImageRecipe } from '../types';

function styledRecipe(): ImageRecipe {
  return {
    ...defaultImageRecipe(),
    // Photo-specific state that must NEVER travel with a look:
    crop: { x: 10, y: 10, width: 200, height: 200 },
    rotate: 90,
    flipH: true,
    perspective: { vertical: 0.2, horizontal: 0 },
    masks: [
      {
        kind: 'radial',
        cx: 0.5,
        cy: 0.5,
        rx: 0.3,
        ry: 0.3,
        feather: 0.5,
        invert: false,
        adjust: { exposure: 0.5, saturation: 0, temperature: 0 },
      },
    ],
    clones: [{ srcX: 0.7, srcY: 0.5, dstX: 0.3, dstY: 0.5, radius: 0.1, feather: 0.5 }],
    overlays: [{ kind: 'emoji', emoji: '🔥', x: 0.5, y: 0.3, size: 0.12, rotation: 0 }],
    // The look:
    adjustments: { brightness: 1, contrast: 1.15, saturation: 1.2 },
    light: { exposure: 0.3, highlights: -0.4, shadows: 0.2, whites: 0, blacks: 0.1 },
    color: { temperature: 0.2, tint: 0, vibrance: 0.3 },
    detail: { sharpen: 0.3, clarity: 0.1, noiseReduction: 0, vignette: 0.25 },
    filterId: 'gold',
    filterStrength: 0.8,
    hsl: { aqua: { hue: 0, saturation: -0.3, luminance: 0 } },
    curves: { master: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] },
    grain: { amount: 0.4, size: 2 },
  };
}

describe('extractLook / applyLook', () => {
  it('moves the whole color/texture look and nothing photo-specific', () => {
    const source = styledRecipe();
    const target = {
      ...defaultImageRecipe(),
      crop: { x: 0, y: 0, width: 500, height: 400 },
      straighten: 5,
      masks: [] as ImageRecipe['masks'],
    };
    const result = applyLook(target, extractLook(source));
    // Look traveled…
    expect(result.filterId).toBe('gold');
    expect(result.light.exposure).toBe(0.3);
    expect(result.hsl?.aqua?.saturation).toBe(-0.3);
    expect(result.curves?.master?.[0].y).toBe(0.1);
    expect(result.grain?.amount).toBe(0.4);
    // …geometry and spatial edits did not.
    expect(result.crop).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(result.straighten).toBe(5);
    expect(result.rotate).toBe(0);
    expect(result.flipH).toBe(false);
    expect(result.perspective).toBeUndefined();
    expect(result.masks).toEqual([]);
    expect(result.clones).toBeUndefined();
    expect(result.overlays).toBeUndefined();
  });

  it('is a REPLACEMENT: absent optional groups clear the target’s', () => {
    const plainLook = extractLook(defaultImageRecipe());
    const busyTarget = styledRecipe();
    const result = applyLook(busyTarget, plainLook);
    expect(result.hsl).toBeUndefined();
    expect(result.curves).toBeUndefined();
    expect(result.grain).toBeUndefined();
    expect(result.filterId).toBeNull();
    // Spatial edits still preserved even by a neutral look.
    expect(result.clones).toHaveLength(1);
  });

  it('extractLook deep-copies (mutating the look never touches the recipe)', () => {
    const recipe = styledRecipe();
    const look = extractLook(recipe);
    look.light.exposure = -1;
    look.curves!.master![0].y = 0.9;
    expect(recipe.light.exposure).toBe(0.3);
    expect(recipe.curves?.master?.[0].y).toBe(0.1);
  });

  it('a pasted look yields a recipe the schema still accepts', () => {
    const pasted = applyLook(defaultImageRecipe(), extractLook(styledRecipe()));
    expect(parseRecipe(serializeRecipe(pasted))).toEqual(pasted);
  });
});

describe('isNeutralLook', () => {
  it('default recipes carry a neutral look; any styling breaks it', () => {
    expect(isNeutralLook(extractLook(defaultImageRecipe()))).toBe(true);
    expect(isNeutralLook(extractLook(styledRecipe()))).toBe(false);
    // A look-neutral recipe with spatial edits is still recipe-non-noop.
    const spatialOnly = { ...defaultImageRecipe(), flipH: true };
    expect(isNeutralLook(extractLook(spatialOnly))).toBe(true);
    expect(isNoopRecipe(spatialOnly)).toBe(false);
  });
});

describe('lookSchema (the preset-persistence contract)', () => {
  it('round-trips a full look and rejects out-of-range values', () => {
    const look = extractLook(styledRecipe());
    expect(lookSchema.safeParse(JSON.parse(JSON.stringify(look))).success).toBe(true);
    expect(
      lookSchema.safeParse({ ...look, light: { ...look.light, exposure: 5 } }).success
    ).toBe(false);
    expect(lookSchema.safeParse({}).success).toBe(false);
  });

  it('lookToPatch explicitly clears optional groups (undefined keys present)', () => {
    const patch = lookToPatch(extractLook(defaultImageRecipe()));
    expect('hsl' in patch).toBe(true);
    expect(patch.hsl).toBeUndefined();
    expect('grain' in patch).toBe(true);
  });
});
