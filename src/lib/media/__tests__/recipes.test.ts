import { describe, it, expect } from 'vitest';
import {
  defaultImageRecipe,
  defaultVideoRecipe,
  isNoopRecipe,
  parseRecipe,
  serializeRecipe,
  recipeEnvelope,
  parseRecipeEnvelope,
} from '../recipes';
import type { ImageRecipe } from '../types';

describe('defaults and no-op detection', () => {
  it('default recipes are no-ops', () => {
    expect(isNoopRecipe(defaultImageRecipe())).toBe(true);
    expect(isNoopRecipe(defaultVideoRecipe())).toBe(true);
  });

  it('any image change breaks no-op', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, rotate: 90 })).toBe(false);
    expect(isNoopRecipe({ ...base, straighten: 2 })).toBe(false);
    expect(isNoopRecipe({ ...base, filterId: 'mono' })).toBe(false);
    expect(isNoopRecipe({ ...base, crop: { x: 0, y: 0, width: 10, height: 10 } })).toBe(false);
    expect(
      isNoopRecipe({ ...base, adjustments: { brightness: 1.1, contrast: 1, saturation: 1 } })
    ).toBe(false);
  });

  it('video: clips or crop break no-op (posterTime alone still passes the file through)', () => {
    expect(isNoopRecipe({ ...defaultVideoRecipe(), posterTime: 3 })).toBe(true);
    expect(
      isNoopRecipe({ ...defaultVideoRecipe(), clips: [{ in: 1, out: 5, volume: 1 }] })
    ).toBe(false);
    expect(
      isNoopRecipe({ ...defaultVideoRecipe(), crop: { x: 0, y: 0, width: 100, height: 100 } })
    ).toBe(false);
  });

  it('aspect choice alone is not an edit', () => {
    expect(isNoopRecipe(defaultImageRecipe('4:5'))).toBe(true);
  });
});

describe('serialization round-trip', () => {
  it('round-trips a full image recipe', () => {
    const recipe: ImageRecipe = {
      kind: 'image',
      crop: { x: 10, y: 20, width: 300, height: 240 },
      rotate: 270,
      straighten: -7.5,
      adjustments: { brightness: 1.2, contrast: 0.9, saturation: 1.4 },
      filterId: 'warm',
      aspect: '4:5',
    };
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
  });

  it('round-trips a v2 multi-clip video recipe', () => {
    const recipe = {
      ...defaultVideoRecipe(),
      clips: [
        { in: 1.5, out: 9, volume: 1, speed: 0.5 as const },
        { in: 0, out: 1.5, volume: 0.25 },
      ],
      crop: { x: 10, y: 0, width: 720, height: 720 },
      aspect: '1:1' as const,
      posterTime: 2,
    };
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
  });

  it('rejects garbage, wrong versions, and out-of-range values', () => {
    expect(parseRecipe('not json')).toBeNull();
    expect(parseRecipe('{"v":2,"recipe":{}}')).toBeNull();
    const bad = { ...defaultImageRecipe(), straighten: 90 };
    expect(parseRecipe(serializeRecipe(bad))).toBeNull();
    const badRotate = { ...defaultImageRecipe(), rotate: 45 as unknown as 0 };
    expect(parseRecipe(serializeRecipe(badRotate))).toBeNull();
  });
});

describe('persistence envelope (post_media.edit_recipe, migration 120)', () => {
  it('round-trips an OBJECT envelope — JSONB stores real JSON, not a string', () => {
    const recipe = { ...defaultVideoRecipe(), clips: [{ in: 1, out: 4, volume: 1 }] };
    const envelope = recipeEnvelope(recipe);
    expect(envelope).toEqual({ v: 2, recipe });
    expect(parseRecipeEnvelope(envelope)).toEqual(recipe);
    // What a DB round-trip actually produces (plain JSON clone).
    expect(parseRecipeEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(recipe);
  });

  it('upgrades stored v1 video envelopes (round B rows): trim → clip, posterTime → timeline space', () => {
    const v1 = { v: 1, recipe: { kind: 'video', trim: { start: 2, end: 8 }, posterTime: 5 } };
    expect(parseRecipeEnvelope(v1)).toEqual({
      kind: 'video',
      clips: [{ in: 2, out: 8, volume: 1 }],
      crop: null,
      aspect: 'free',
      posterTime: 3,
    });
    // Untrimmed v1: timeline == source, posterTime unchanged.
    const v1NoTrim = { v: 1, recipe: { kind: 'video', trim: null, posterTime: 4 } };
    expect(parseRecipeEnvelope(v1NoTrim)).toEqual({ ...defaultVideoRecipe(), posterTime: 4 });
    // v1 images pass through shape-unchanged.
    expect(parseRecipeEnvelope({ v: 1, recipe: defaultImageRecipe() })).toEqual(defaultImageRecipe());
  });

  it('rejects non-objects, unknown versions, and invalid recipes', () => {
    expect(parseRecipeEnvelope(null)).toBeNull();
    expect(parseRecipeEnvelope('{"v":2}')).toBeNull(); // strings are not envelopes
    expect(parseRecipeEnvelope({ v: 3, recipe: defaultImageRecipe() })).toBeNull();
    expect(parseRecipeEnvelope({ v: 2, recipe: { kind: 'video', trim: null, posterTime: 0 } })).toBeNull(); // v1 shape under v2
    expect(parseRecipeEnvelope({ v: 1, recipe: { kind: 'image' } })).toBeNull();
  });
});
