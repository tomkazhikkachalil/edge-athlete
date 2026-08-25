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
    // Engine-round fields (v3)
    expect(isNoopRecipe({ ...base, flipH: true })).toBe(false);
    expect(isNoopRecipe({ ...base, flipV: true })).toBe(false);
    expect(isNoopRecipe({ ...base, light: { ...base.light, exposure: 0.2 } })).toBe(false);
    expect(isNoopRecipe({ ...base, color: { ...base.color, vibrance: -0.3 } })).toBe(false);
    expect(isNoopRecipe({ ...base, detail: { ...base.detail, vignette: 0.4 } })).toBe(false);
  });

  it('filterStrength alone is not an edit (irrelevant without a filter)', () => {
    expect(isNoopRecipe({ ...defaultImageRecipe(), filterStrength: 0.5 })).toBe(true);
  });

  it('perspective: {0,0} and absent are both no-ops; any value is an edit', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, perspective: { vertical: 0, horizontal: 0 } })).toBe(true);
    expect(isNoopRecipe({ ...base, perspective: { vertical: 0.2, horizontal: 0 } })).toBe(false);
  });

  it('perspective round-trips through the envelope and rejects out-of-range', () => {
    const recipe = { ...defaultImageRecipe(), perspective: { vertical: -0.3, horizontal: 0.5 } };
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    const bad = { ...defaultImageRecipe(), perspective: { vertical: 2, horizontal: 0 } };
    expect(parseRecipe(serializeRecipe(bad))).toBeNull();
  });

  it('hsl mixer: zeroed/absent bands are no-ops; values round-trip sparsely', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, hsl: {} })).toBe(true);
    expect(
      isNoopRecipe({ ...base, hsl: { blue: { hue: 0, saturation: 0, luminance: 0 } } })
    ).toBe(true);
    expect(
      isNoopRecipe({ ...base, hsl: { blue: { hue: 0.3, saturation: 0, luminance: 0 } } })
    ).toBe(false);
    const recipe = {
      ...base,
      hsl: {
        aqua: { hue: -0.2, saturation: 0.5, luminance: -0.4 },
        red: { hue: 0.1, saturation: 0, luminance: 0 },
      },
    };
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    const bad = { ...base, hsl: { red: { hue: 3, saturation: 0, luminance: 0 } } };
    expect(parseRecipe(serializeRecipe(bad))).toBeNull();
  });

  it('curves: identity/absent are no-ops; shaped sets round-trip; unsorted rejected', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, curves: {} })).toBe(true);
    expect(
      isNoopRecipe({ ...base, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })
    ).toBe(true);
    const recipe = {
      ...base,
      curves: {
        master: [
          { x: 0, y: 0.1 },
          { x: 0.5, y: 0.6 },
          { x: 1, y: 0.95 },
        ],
        b: [
          { x: 0, y: 0 },
          { x: 1, y: 0.8 },
        ],
      },
    };
    expect(isNoopRecipe(recipe)).toBe(false);
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    const unsorted = {
      ...base,
      curves: { master: [{ x: 0.5, y: 0 }, { x: 0.2, y: 1 }] },
    };
    expect(parseRecipe(serializeRecipe(unsorted))).toBeNull();
    const tooFew = { ...base, curves: { master: [{ x: 0, y: 0 }] } };
    expect(parseRecipe(serializeRecipe(tooFew))).toBeNull();
  });

  it('masks: geometry-only lists are no-ops; both kinds round-trip; cap enforced', () => {
    const base = defaultImageRecipe();
    const radial = {
      kind: 'radial' as const,
      cx: 0.4,
      cy: 0.3,
      rx: 0.25,
      ry: 0.35,
      feather: 0.6,
      invert: true,
      adjust: { exposure: 0.5, saturation: -0.2, temperature: 0.1 },
    };
    const linear = {
      kind: 'linear' as const,
      x0: 0.5,
      y0: 0.1,
      x1: 0.5,
      y1: 0.6,
      adjust: { exposure: -0.4, saturation: 0, temperature: 0 },
    };
    expect(
      isNoopRecipe({ ...base, masks: [{ ...radial, adjust: { exposure: 0, saturation: 0, temperature: 0 } }] })
    ).toBe(true);
    const recipe = { ...base, masks: [radial, linear] };
    expect(isNoopRecipe(recipe)).toBe(false);
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    const five = { ...base, masks: [radial, radial, radial, radial, radial] };
    expect(parseRecipe(serializeRecipe(five))).toBeNull();
  });

  it('brush masks: strokes round-trip; caps enforced (E4f)', () => {
    const base = defaultImageRecipe();
    const brush = {
      kind: 'brush' as const,
      strokes: [
        {
          points: [
            { x: 0.2, y: 0.5 },
            { x: 0.8, y: 0.55 },
          ],
          radius: 0.08,
          feather: 0.4,
        },
        { points: [{ x: 0.5, y: 0.5 }], radius: 0.05, feather: 1, erase: true },
      ],
      adjust: { exposure: 0.4, saturation: 0, temperature: 0 },
    };
    const recipe = { ...base, masks: [brush] };
    expect(isNoopRecipe(recipe)).toBe(false);
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    // Zero-adjust brush = placement only = no-op (the mask rule).
    expect(
      isNoopRecipe({
        ...base,
        masks: [{ ...brush, adjust: { exposure: 0, saturation: 0, temperature: 0 } }],
      })
    ).toBe(true);
    // Caps: >256 points in a stroke and >32 strokes both reject.
    const fat = {
      ...brush,
      strokes: [
        {
          points: Array.from({ length: 257 }, (_, i) => ({ x: i / 257, y: 0.5 })),
          radius: 0.05,
          feather: 0,
        },
      ],
    };
    expect(parseRecipe(serializeRecipe({ ...base, masks: [fat] }))).toBeNull();
    const many = { ...brush, strokes: Array.from({ length: 33 }, () => brush.strokes[0]) };
    expect(parseRecipe(serializeRecipe({ ...base, masks: [many] }))).toBeNull();
  });

  it('clone stamps: absent/empty are no-ops; stamps round-trip; cap enforced (E4g)', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, clones: [] })).toBe(true);
    const s = { srcX: 0.7, srcY: 0.4, dstX: 0.3, dstY: 0.4, radius: 0.1, feather: 0.6 };
    const recipe = { ...base, clones: [s] };
    expect(isNoopRecipe(recipe)).toBe(false);
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    const nine = { ...base, clones: Array.from({ length: 9 }, () => s) };
    expect(parseRecipe(serializeRecipe(nine))).toBeNull();
    expect(
      parseRecipe(serializeRecipe({ ...base, clones: [{ ...s, radius: 0.9 }] }))
    ).toBeNull();
  });

  it('overlays: absent/empty are no-ops; text + emoji round-trip; bad values reject (E4h)', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, overlays: [] })).toBe(true);
    const textOverlay = {
      kind: 'text' as const,
      content: 'GAME DAY',
      x: 0.5,
      y: 0.8,
      size: 0.1,
      fontId: 'caveat' as const,
      color: '#f97316',
      rotation: -12,
      pill: true,
    };
    const emojiOverlay = { kind: 'emoji' as const, emoji: '🔥', x: 0.2, y: 0.2, size: 0.15, rotation: 0 };
    const recipe = { ...base, overlays: [textOverlay, emojiOverlay] };
    expect(isNoopRecipe(recipe)).toBe(false);
    expect(parseRecipe(serializeRecipe(recipe))).toEqual(recipe);
    // Rejections: empty content, non-hex color, oversize list.
    expect(
      parseRecipe(serializeRecipe({ ...base, overlays: [{ ...textOverlay, content: '' }] }))
    ).toBeNull();
    expect(
      parseRecipe(serializeRecipe({ ...base, overlays: [{ ...textOverlay, color: 'red' }] }))
    ).toBeNull();
    expect(
      parseRecipe(serializeRecipe({ ...base, overlays: Array.from({ length: 9 }, () => emojiOverlay) }))
    ).toBeNull();
  });

  it('grain: absent/zero-amount is a no-op; settings round-trip; range enforced', () => {
    const base = defaultImageRecipe();
    expect(isNoopRecipe({ ...base, grain: { amount: 0, size: 2 } })).toBe(true);
    const grainy = { ...base, grain: { amount: 0.4, size: 1.5 } };
    expect(isNoopRecipe(grainy)).toBe(false);
    expect(parseRecipe(serializeRecipe(grainy))).toEqual(grainy);
    expect(parseRecipe(serializeRecipe({ ...base, grain: { amount: 0.4, size: 9 } }))).toBeNull();
  });

  it('9:16 round-trips in both image and video recipes (story crop)', () => {
    const image = { ...defaultImageRecipe('9:16' as const) };
    expect(parseRecipe(serializeRecipe(image))).toEqual(image);
    const video = { ...defaultVideoRecipe(), aspect: '9:16' as const };
    expect(parseRecipe(serializeRecipe(video))).toEqual(video);
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
  it('round-trips a full image recipe (every v3 field non-default)', () => {
    const recipe: ImageRecipe = {
      kind: 'image',
      crop: { x: 10, y: 20, width: 300, height: 240 },
      rotate: 270,
      straighten: -7.5,
      flipH: true,
      flipV: false,
      adjustments: { brightness: 1.2, contrast: 0.9, saturation: 1.4 },
      light: { exposure: 0.4, highlights: -0.5, shadows: 0.3, whites: 0.1, blacks: -0.2 },
      color: { temperature: -0.25, tint: 0.15, vibrance: 0.6 },
      detail: { sharpen: 0.5, clarity: 0.2, noiseReduction: 0.1, vignette: -0.35 },
      filterId: 'warm',
      filterStrength: 0.7,
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
    expect(envelope).toEqual({ v: 3, recipe });
    expect(parseRecipeEnvelope(envelope)).toEqual(recipe);
    // What a DB round-trip actually produces (plain JSON clone).
    expect(parseRecipeEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(recipe);
  });

  it('upgrades stored v2 image envelopes: engine-round fields arrive neutral', () => {
    const v2Image = {
      kind: 'image',
      crop: { x: 5, y: 5, width: 100, height: 80 },
      rotate: 90,
      straighten: 3,
      adjustments: { brightness: 1.1, contrast: 0.95, saturation: 1.2 },
      filterId: 'fade',
      aspect: '1:1',
    };
    expect(parseRecipeEnvelope({ v: 2, recipe: v2Image })).toEqual({
      ...v2Image,
      flipH: false,
      flipV: false,
      light: { exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
      color: { temperature: 0, tint: 0, vibrance: 0 },
      detail: { sharpen: 0, clarity: 0, noiseReduction: 0, vignette: 0 },
      filterStrength: 1,
    });
    // v2 video is shape-identical in v3.
    const v2Video = { ...defaultVideoRecipe(), clips: [{ in: 0, out: 2, volume: 0.5 }] };
    expect(parseRecipeEnvelope({ v: 2, recipe: v2Video })).toEqual(v2Video);
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
    expect(parseRecipeEnvelope({ v: 4, recipe: defaultImageRecipe() })).toBeNull(); // future version
    expect(parseRecipeEnvelope({ v: 2, recipe: { kind: 'video', trim: null, posterTime: 0 } })).toBeNull(); // v1 shape under v2
    expect(parseRecipeEnvelope({ v: 1, recipe: { kind: 'image' } })).toBeNull();
    // v2 image shape under v3 (missing engine fields) is malformed, not upgraded.
    const { flipH: _f, ...v2Shaped } = defaultImageRecipe();
    void _f;
    expect(parseRecipeEnvelope({ v: 3, recipe: v2Shaped })).toBeNull();
  });
});
