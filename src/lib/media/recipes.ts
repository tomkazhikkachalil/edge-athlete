/**
 * Edit recipe construction, no-op detection, and (de)serialization.
 *
 * Recipes live IN MEMORY per composer session (a serialized recipe without
 * its source File is useless after reload, so no localStorage — deliberate
 * deviation from the workout-draft pattern; IndexedDB File persistence is a
 * possible future). The zod schema exists so recipes can be persisted later
 * without rework, and to validate anything that does round-trip.
 */

import { z } from 'zod';
import type { Adjustments, AspectRatioId, EditRecipe, ImageRecipe, VideoRecipe } from './types';
import { isNeutral, NEUTRAL_ADJUSTMENTS } from './filters';

export function defaultImageRecipe(aspect: AspectRatioId = 'free'): ImageRecipe {
  return {
    kind: 'image',
    crop: null,
    rotate: 0,
    straighten: 0,
    adjustments: { ...NEUTRAL_ADJUSTMENTS },
    filterId: null,
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
 * an edit. posterTime alone still passes the file through.
 */
export function isNoopRecipe(recipe: EditRecipe): boolean {
  if (recipe.kind === 'video') {
    return recipe.clips.length === 0 && recipe.crop === null;
  }
  return (
    recipe.crop === null &&
    recipe.rotate === 0 &&
    recipe.straighten === 0 &&
    recipe.filterId === null &&
    isNeutral(recipe.adjustments)
  );
}

const adjustmentsSchema: z.ZodType<Adjustments> = z.object({
  brightness: z.number().min(0).max(2),
  contrast: z.number().min(0).max(2),
  saturation: z.number().min(0).max(2),
});

const cropRectSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
});

const imageRecipeSchema = z.object({
  kind: z.literal('image'),
  crop: cropRectSchema.nullable(),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  straighten: z.number().min(-45).max(45),
  adjustments: adjustmentsSchema,
  filterId: z.string().nullable(),
  aspect: z.enum(['free', '1:1', '4:5', '16:9', '3:1']),
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
});

const videoRecipeSchema = z.object({
  kind: z.literal('video'),
  clips: z.array(videoClipSchema).max(50),
  crop: cropRectSchema.nullable(),
  aspect: z.enum(['free', '1:1', '4:5', '16:9', '3:1']),
  posterTime: z.number().min(0),
});

export const editRecipeSchema = z.discriminatedUnion('kind', [imageRecipeSchema, videoRecipeSchema]);
const editRecipeV1Schema = z.discriminatedUnion('kind', [imageRecipeSchema, videoRecipeV1Schema]);

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
export function recipeEnvelope(recipe: EditRecipe): { v: 2; recipe: EditRecipe } {
  return { v: 2, recipe };
}

/** Validate an untrusted envelope (client payload / DB row) into a recipe.
 *  v1 rows (round B) upgrade transparently; null on anything malformed —
 *  callers treat that as "no recipe". */
export function parseRecipeEnvelope(value: unknown): EditRecipe | null {
  if (!value || typeof value !== 'object') return null;
  const v = (value as { v?: unknown }).v;
  const rawRecipe = (value as { recipe?: unknown }).recipe;
  if (v === 2) {
    const result = editRecipeSchema.safeParse(rawRecipe);
    return result.success ? result.data : null;
  }
  if (v === 1) {
    const result = editRecipeV1Schema.safeParse(rawRecipe);
    if (!result.success) return null;
    return result.data.kind === 'video' ? upgradeVideoRecipeV1(result.data) : result.data;
  }
  return null;
}
