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

  it('video: only trim breaks no-op (posterTime alone still passes the file through)', () => {
    expect(isNoopRecipe({ ...defaultVideoRecipe(), posterTime: 3 })).toBe(true);
    expect(isNoopRecipe({ ...defaultVideoRecipe(), trim: { start: 1, end: 5 } })).toBe(false);
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

  it('round-trips a video recipe', () => {
    const recipe = { ...defaultVideoRecipe(), trim: { start: 1.5, end: 9 }, posterTime: 2 };
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
    const recipe = { ...defaultVideoRecipe(), trim: { start: 1, end: 4 } };
    const envelope = recipeEnvelope(recipe);
    expect(envelope).toEqual({ v: 1, recipe });
    expect(parseRecipeEnvelope(envelope)).toEqual(recipe);
    // What a DB round-trip actually produces (plain JSON clone).
    expect(parseRecipeEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(recipe);
  });

  it('rejects non-objects, wrong versions, and invalid recipes', () => {
    expect(parseRecipeEnvelope(null)).toBeNull();
    expect(parseRecipeEnvelope('{"v":1}')).toBeNull(); // strings are not envelopes
    expect(parseRecipeEnvelope({ v: 2, recipe: defaultImageRecipe() })).toBeNull();
    expect(parseRecipeEnvelope({ v: 1, recipe: { kind: 'image' } })).toBeNull();
  });
});
