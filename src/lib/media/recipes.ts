/**
 * Edit recipe construction, no-op detection, and (de)serialization.
 *
 * Recipes live IN MEMORY per composer session (a serialized recipe without
 * its source File is useless after reload, so no localStorage — deliberate
 * deviation from the workout-draft pattern; IndexedDB File persistence is a
 * possible future). The zod schema exists so recipes can be persisted later
 * without rework, and to validate anything that does round-trip.
 *
 * Versioning: the envelope is {v: N, recipe}. v3 (engine round) added flip,
 * light/color/detail groups and filterStrength to images — all neutral-
 * defaulted, so v2 → v3 is a spread plus neutrals. Stored v1/v2 rows
 * upgrade transparently on read; writes always emit the current version.
 */

import { z } from 'zod';
import type { Adjustments, AspectRatioId, EditRecipe, ImageRecipe, VideoRecipe } from './types';
import {
  isNeutral,
  isNeutralColor,
  isNeutralDetail,
  isNeutralLight,
  NEUTRAL_ADJUSTMENTS,
  NEUTRAL_COLOR,
  NEUTRAL_DETAIL,
  NEUTRAL_LIGHT,
} from './filters';
import { isNeutralPerspective } from './engine/perspective-math';
import { isNeutralHsl } from './engine/hsl-math';
import { isNeutralCurves } from './engine/curves-math';
import { isNeutralMasks } from './engine/mask-math';

export function defaultImageRecipe(aspect: AspectRatioId = 'free'): ImageRecipe {
  return {
    kind: 'image',
    crop: null,
    rotate: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    adjustments: { ...NEUTRAL_ADJUSTMENTS },
    light: { ...NEUTRAL_LIGHT },
    color: { ...NEUTRAL_COLOR },
    detail: { ...NEUTRAL_DETAIL },
    filterId: null,
    filterStrength: 1,
    aspect,
  };
}

export function defaultVideoRecipe(): VideoRecipe {
  return { kind: 'video', clips: [], crop: null, aspect: 'free', posterTime: 0 };
}

/**
 * A no-op recipe means the ORIGINAL file can upload untouched (no re-encode
 * → no quality loss, GIFs keep animating). Callers must still force a
 * re-encode for non-allowlisted source types (HEIC) regardless of no-op.
 * Video: [] clips = whole file; any real clip, volume change or reframe is
 * an edit. posterTime alone still passes the file through. filterStrength
 * is irrelevant when filterId is null, so it never breaks no-op by itself.
 */
export function isNoopRecipe(recipe: EditRecipe): boolean {
  if (recipe.kind === 'video') {
    return recipe.clips.length === 0 && recipe.crop === null;
  }
  return (
    recipe.crop === null &&
    recipe.rotate === 0 &&
    recipe.straighten === 0 &&
    !recipe.flipH &&
    !recipe.flipV &&
    recipe.filterId === null &&
    isNeutral(recipe.adjustments) &&
    isNeutralLight(recipe.light) &&
    isNeutralColor(recipe.color) &&
    isNeutralDetail(recipe.detail) &&
    isNeutralPerspective(recipe.perspective) &&
    isNeutralHsl(recipe.hsl) &&
    isNeutralCurves(recipe.curves) &&
    isNeutralMasks(recipe.masks)
  );
}

const adjustmentsSchema: z.ZodType<Adjustments> = z.object({
  brightness: z.number().min(0).max(2),
  contrast: z.number().min(0).max(2),
  saturation: z.number().min(0).max(2),
});

const signed = () => z.number().min(-1).max(1);
const unsigned = () => z.number().min(0).max(1);

const lightSchema = z.object({
  exposure: signed(),
  highlights: signed(),
  shadows: signed(),
  whites: signed(),
  blacks: signed(),
});

const colorSchema = z.object({
  temperature: signed(),
  tint: signed(),
  vibrance: signed(),
});

const detailSchema = z.object({
  sharpen: unsigned(),
  clarity: unsigned(),
  noiseReduction: unsigned(),
  vignette: signed(),
});

const cropRectSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

const aspectSchema = z.enum(['free', '1:1', '4:5', '9:16', '16:9', '3:1']);

const hslBandSchema = z.object({
  hue: signed(),
  saturation: signed(),
  luminance: signed(),
});

const maskAdjustSchema = z.object({
  exposure: signed(),
  saturation: signed(),
  temperature: signed(),
});

const maskSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('radial'),
    cx: unsigned(),
    cy: unsigned(),
    rx: z.number().min(0.01).max(2),
    ry: z.number().min(0.01).max(2),
    feather: unsigned(),
    invert: z.boolean(),
    adjust: maskAdjustSchema,
  }),
  z.object({
    kind: z.literal('linear'),
    x0: unsigned(),
    y0: unsigned(),
    x1: unsigned(),
    y1: unsigned(),
    adjust: maskAdjustSchema,
  }),
]);

// A tone curve: 2..8 points, both axes 0..1, strictly ascending x.
const curveSchema = z
  .array(z.object({ x: unsigned(), y: unsigned() }))
  .min(2)
  .max(8)
  .refine(pts => pts.every((p, i) => i === 0 || p.x > pts[i - 1].x), {
    message: 'curve points must be strictly ascending in x',
  });

// Shared v1/v2 image core — v3 extends it with the engine-round fields.
const imageRecipeV2Schema = z.object({
  kind: z.literal('image'),
  crop: cropRectSchema.nullable(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  straighten: z.number().min(-45).max(45),
  adjustments: adjustmentsSchema,
  filterId: z.string().nullable(),
  aspect: aspectSchema,
});
type ImageRecipeV2 = z.infer<typeof imageRecipeV2Schema>;

const imageRecipeSchema = imageRecipeV2Schema.extend({
  flipH: z.boolean(),
  flipV: z.boolean(),
  light: lightSchema,
  color: colorSchema,
  detail: detailSchema,
  filterStrength: unsigned(),
  // Additive within v3 (videoClip.speed precedent): absent = none.
  perspective: z.object({ vertical: signed(), horizontal: signed() }).optional(),
  hsl: z
    .object({
      red: hslBandSchema.optional(),
      orange: hslBandSchema.optional(),
      yellow: hslBandSchema.optional(),
      green: hslBandSchema.optional(),
      aqua: hslBandSchema.optional(),
      blue: hslBandSchema.optional(),
      purple: hslBandSchema.optional(),
      magenta: hslBandSchema.optional(),
    })
    .optional(),
  curves: z
    .object({
      master: curveSchema.optional(),
      r: curveSchema.optional(),
      g: curveSchema.optional(),
      b: curveSchema.optional(),
    })
    .optional(),
  masks: z.array(maskSchema).max(4).optional(),
});

// v1 video shape (single trim) — persisted rows from round B upgrade on read.
const videoRecipeV1Schema = z.object({
  kind: z.literal('video'),
  trim: z.object({ start: z.number().min(0), end: z.number().positive() }).nullable(),
  posterTime: z.number().min(0),
});
type VideoRecipeV1 = z.infer<typeof videoRecipeV1Schema>;

const videoClipSchema = z.object({
  in: z.number().min(0),
  out: z.number().positive(),
  volume: z.number().min(0).max(1),
  // Slo-mo round: fixed chip set, absent = 1. Stays v2 (additive).
  speed: z
    .union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2)])
    .optional(),
});

// Video is unchanged in v3 — one schema serves the v2 and v3 branches.
const videoRecipeSchema = z.object({
  kind: z.literal('video'),
  clips: z.array(videoClipSchema).max(50),
  crop: cropRectSchema.nullable(),
  aspect: aspectSchema,
  posterTime: z.number().min(0),
});

export const editRecipeSchema = z.discriminatedUnion('kind', [imageRecipeSchema, videoRecipeSchema]);
const editRecipeV2Schema = z.discriminatedUnion('kind', [imageRecipeV2Schema, videoRecipeSchema]);
const editRecipeV1Schema = z.discriminatedUnion('kind', [imageRecipeV2Schema, videoRecipeV1Schema]);

/** v1 video → v2: trim becomes the single clip; posterTime moves from
 *  source space into timeline space (subtract the trim start). */
export function upgradeVideoRecipeV1(recipe: VideoRecipeV1): VideoRecipe {
  const clips = recipe.trim
    ? [{ in: recipe.trim.start, out: recipe.trim.end, volume: 1 }]
    : [];
  const posterTime = recipe.trim
    ? Math.min(
        Math.max(recipe.posterTime - recipe.trim.start, 0),
        recipe.trim.end - recipe.trim.start
      )
    : recipe.posterTime;
  return { kind: 'video', clips, crop: null, aspect: 'free', posterTime };
}

/** v2 image → v3: every new field is neutral, so old edits render the same. */
export function upgradeImageRecipeV2(recipe: ImageRecipeV2): ImageRecipe {
  return {
    ...recipe,
    flipH: false,
    flipV: false,
    light: { ...NEUTRAL_LIGHT },
    color: { ...NEUTRAL_COLOR },
    detail: { ...NEUTRAL_DETAIL },
    filterStrength: 1,
  };
}

export function serializeRecipe(recipe: EditRecipe): string {
  return JSON.stringify(recipeEnvelope(recipe));
}

export function parseRecipe(raw: string): EditRecipe | null {
  try {
    return parseRecipeEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The persistence shape — what post_media.edit_recipe (JSONB) holds. Kept
 *  as an object (not a string) so the column stores real JSON. */
export function recipeEnvelope(recipe: EditRecipe): { v: 3; recipe: EditRecipe } {
  return { v: 3, recipe };
}

/** Validate an untrusted envelope (client payload / DB row) into a recipe.
 *  v1/v2 rows upgrade transparently; null on anything malformed — callers
 *  treat that as "no recipe". */
export function parseRecipeEnvelope(value: unknown): EditRecipe | null {
  if (!value || typeof value !== 'object') return null;
  const v = (value as { v?: unknown }).v;
  const rawRecipe = (value as { recipe?: unknown }).recipe;
  if (v === 3) {
    const result = editRecipeSchema.safeParse(rawRecipe);
    return result.success ? result.data : null;
  }
  if (v === 2) {
    const result = editRecipeV2Schema.safeParse(rawRecipe);
    if (!result.success) return null;
    return result.data.kind === 'image' ? upgradeImageRecipeV2(result.data) : result.data;
  }
  if (v === 1) {
    const result = editRecipeV1Schema.safeParse(rawRecipe);
    if (!result.success) return null;
    return result.data.kind === 'video'
      ? upgradeVideoRecipeV1(result.data)
      : upgradeImageRecipeV2(result.data);
  }
  return null;
}
