// ── Profile photo recipes: the ONE rule for the kept original (PR 5, Oct 14 2026)
// Pure. A profile photo is a DERIVED render (avatar_url / cover_url) of a kept
// ORIGINAL (avatar_source_url / cover_source_url, migration 264) through a
// crop recipe (avatar_recipe / cover_recipe — the editor's envelope, the
// post_media.edit_recipe shape). "Adjust the current photo" reopens the
// original at the stored crop; Done re-renders from the original — never from
// the crop (lossy once, never a spiral).

import { parseRecipeEnvelope, recipeEnvelope, defaultImageRecipe } from '@/lib/media/recipes';
import type { ImageRecipe, CropRect, AspectRatioId } from '@/lib/media/types';
import type { ProfilePhotoSlot } from './photo-paths';

/** The longest edge a kept original is bounded to on the device before it uploads. */
export const PROFILE_SOURCE_MAX_DIM = 2048;

/** The slot's fixed shape — the editor's ratio id and its numeric aspect. */
export const SLOT_ASPECT: Record<ProfilePhotoSlot, { id: Extract<AspectRatioId, '1:1' | '3:1'>; ratio: number }> = {
  avatar: { id: '1:1', ratio: 1 },
  cover: { id: '3:1', ratio: 3 },
};

/** An untrusted recipe (the request body, the row) → an IMAGE recipe, or null. */
export function parseProfilePhotoRecipe(value: unknown): ImageRecipe | null {
  const recipe = parseRecipeEnvelope(value);
  return recipe && recipe.kind === 'image' ? recipe : null;
}

/** The persistence shape of a slot's recipe (the row holds the envelope). */
export function profilePhotoRecipeEnvelope(recipe: ImageRecipe): { v: 3; recipe: ImageRecipe } {
  return recipeEnvelope(recipe) as { v: 3; recipe: ImageRecipe };
}

/**
 * The largest centred rectangle of the slot's aspect inside a w × h image —
 * what a camera capture is cropped to the instant it comes back (Adjust is
 * the pencil). Integers; never larger than the image.
 */
export function centeredCrop(width: number, height: number, ratio: number): CropRect {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  let cw = w;
  let ch = Math.floor(w / ratio);
  if (ch > h) {
    ch = h;
    cw = Math.floor(h * ratio);
  }
  cw = Math.max(1, Math.min(w, cw));
  ch = Math.max(1, Math.min(h, ch));
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), width: cw, height: ch };
}

/** The recipe a camera capture renders through: the slot's ratio, the centred crop, nothing else. */
export function captureRecipe(slot: ProfilePhotoSlot, width: number, height: number): ImageRecipe {
  const { id, ratio } = SLOT_ASPECT[slot];
  return { ...defaultImageRecipe(id), crop: centeredCrop(width, height, ratio) };
}

/** The object path of a kept original: profile-sources/{profileId}/{slot}-{ts}.{ext} (the uploads bucket). */
export function profileSourcePath(profileId: string, slot: ProfilePhotoSlot, now: number, ext = 'jpg'): string {
  return `profile-sources/${profileId}/${slot}-${now}.${ext}`;
}

/**
 * The owner-only door to a kept original — the proxy signs the object for
 * the owner or a consented guardian; `?v=` is the file name, so a replaced
 * original is never served from a cache.
 */
export function profileSourceProxyUrl(profileId: string, slot: ProfilePhotoSlot, sourceUrl: string | null | undefined): string | null {
  if (!profileId || !sourceUrl) return null;
  const seg = sourceUrl.split('?')[0].split('/').pop() || '';
  return `/api/media/profile-source/${profileId}?slot=${slot}${seg ? `&v=${encodeURIComponent(seg)}` : ''}`;
}

/** What a POST to a slot's route carries beside the derived file (the ONE contract, both routes). */
export interface ProfilePhotoPayload {
  /** The derived render — what the profile shows. */
  file: File;
  /** The original it was rendered from (bounded to PROFILE_SOURCE_MAX_DIM); null = none to keep. */
  source: File | null;
  /** The crop that made `file` from the original. */
  recipe: ImageRecipe | null;
  /** Adjust: keep the stored original, only the recipe and the render change. */
  sameSource: boolean;
}
