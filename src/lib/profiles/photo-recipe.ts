// ── Profile photo recipes: the ONE rule for the kept original (PR 5, Oct 14 2026)
// Pure. A profile photo is a DERIVED render (avatar_url / cover_url) of a kept
// ORIGINAL (avatar_source_url / cover_source_url, migration 264) through a
// recipe (avatar_recipe / cover_recipe — the editor's FULL envelope, the
// post_media.edit_recipe shape: crop, adjustments, filters, text, …). "Adjust
// the current photo" reopens the original with every stored edit; Done
// re-renders from the original — never from the render (lossy once, never a
// spiral).

import { parseRecipeEnvelope, recipeEnvelope } from '@/lib/media/recipes';
import type { ImageRecipe } from '@/lib/media/types';
import type { ProfilePhotoSlot } from './photo-paths';

/** The longest edge a kept original is bounded to on the device before it uploads. */
export const PROFILE_SOURCE_MAX_DIM = 2048;

// The photo and its original ride ONE request, and a Vercel request body is
// capped at 4.5 MB — the platform refuses a bigger one before our route runs
// (every-browser round, Oct 16 2026: a 2000 px PNG wallpaper, kept as-is,
// made a 9.3 MB body; the pick limit says 10 MB). So an original is kept
// byte-for-byte only when it is small, and the request never passes the
// budget: past it the original is left out and the render uploads alone
// (Adjust then starts from the render — lossy once, as for a pre-264 photo).
export const PROFILE_SOURCE_KEEP_MAX_BYTES = 2.5 * 1024 * 1024;
/** Under 4.5 MB with room for the multipart framing and the recipe. */
export const PROFILE_PHOTO_BODY_BUDGET = 4 * 1024 * 1024;

const KEEP_AS_IS_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** The pick itself may be the kept original: an untouched type, within the edge bound, and small. */
export function keepSourceAsIs(type: string, bytes: number, longestEdge: number | null): boolean {
  return KEEP_AS_IS_TYPES.includes(type) && longestEdge !== null && longestEdge <= PROFILE_SOURCE_MAX_DIM && bytes <= PROFILE_SOURCE_KEEP_MAX_BYTES;
}

/** The original goes with the render only while the two fit one request. */
export function sourceFitsRequest(renderBytes: number, sourceBytes: number): boolean {
  return renderBytes + sourceBytes <= PROFILE_PHOTO_BODY_BUDGET;
}

/** An untrusted recipe (the request body, the row) → an IMAGE recipe, or null. */
export function parseProfilePhotoRecipe(value: unknown): ImageRecipe | null {
  const recipe = parseRecipeEnvelope(value);
  return recipe && recipe.kind === 'image' ? recipe : null;
}

/** The persistence shape of a slot's recipe (the row holds the envelope). */
export function profilePhotoRecipeEnvelope(recipe: ImageRecipe): { v: 3; recipe: ImageRecipe } {
  return recipeEnvelope(recipe) as { v: 3; recipe: ImageRecipe };
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
  /** The edits that made `file` from the original (the full editor recipe). */
  recipe: ImageRecipe | null;
  /** Adjust: keep the stored original, only the recipe and the render change. */
  sameSource: boolean;
}
