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
  return { kind: 'video', trim: null, posterTime: 0 };
}

/**
 * A no-op recipe means the ORIGINAL file can upload untouched (no re-encode
 * → no quality loss, GIFs keep animating). Callers must still force a
 * re-encode for non-allowlisted source types (HEIC) regardless of no-op.
 */
export function isNoopRecipe(recipe: EditRecipe): boolean {
  if (recipe.kind === 'video') {
    return recipe.trim === null;
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

const videoRecipeSchema = z.object({
  kind: z.literal('video'),
  trim: z.object({ start: z.number().min(0), end: z.number().positive() }).nullable(),
  posterTime: z.number().min(0),
});

export const editRecipeSchema = z.discriminatedUnion('kind', [imageRecipeSchema, videoRecipeSchema]);

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
export function recipeEnvelope(recipe: EditRecipe): { v: 1; recipe: EditRecipe } {
  return { v: 1, recipe };
}

/** Validate an untrusted envelope (client payload / DB row) into a recipe.
 *  Null on anything malformed — callers treat that as "no recipe". */
export function parseRecipeEnvelope(value: unknown): EditRecipe | null {
  if (!value || typeof value !== 'object') return null;
  if ((value as { v?: unknown }).v !== 1) return null;
  const result = editRecipeSchema.safeParse((value as { recipe?: unknown }).recipe);
  return result.success ? result.data : null;
}
