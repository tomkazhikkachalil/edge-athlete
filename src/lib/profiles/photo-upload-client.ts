// ── Profile photos on the device (PR 5, Oct 14 2026) — browser-only ──────────
// The three things a profile photo needs before its POST, beside the pure
// rules in photo-recipe.ts: the kept original bounded for upload, the
// request body, and the editor asset that Adjust opens.

import type { ImageRecipe, MediaAsset } from '@/lib/media/types';
import { stageUpload } from '@/lib/media/upload';
import { keepSourceAsIs, PROFILE_SOURCE_MAX_DIM, type ProfilePhotoPayload } from './photo-recipe';
import type { ProfilePhotoSlot } from './photo-paths';

/**
 * The original to keep: the file itself when keepSourceAsIs allows it (a
 * small JPEG / PNG / WebP within PROFILE_SOURCE_MAX_DIM), else a JPEG
 * re-encode bounded to it (a HEIC, a GIF, a 12 MP capture, a big PNG). Never throws: null means "keep no original" — the render
 * uploads alone, and Adjust starts from it.
 */
export async function prepareProfileSource(file: File): Promise<File | null> {
  try {
    const { probeImageDims } = await import('@/lib/media/probe');
    const dims = await probeImageDims(file);
    if (keepSourceAsIs(file.type, file.size, dims ? Math.max(dims.width, dims.height) : null)) return file;
    const [{ renderImage }, { defaultImageRecipe }] = await Promise.all([import('@/lib/media/render'), import('@/lib/media/recipes')]);
    const blob = await renderImage(file, defaultImageRecipe(), { maxDimension: PROFILE_SOURCE_MAX_DIM, mime: 'image/jpeg', quality: 0.9 });
    return new File([blob], 'original.jpg', { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[profile photo] could not prepare the original; uploading the render alone:', err);
    return null;
  }
}

export interface ProfilePhotoAnswer {
  success: true;
  avatar_url?: string;
  cover_url?: string;
  avatar_source_url?: string | null;
  cover_source_url?: string | null;
  avatar_recipe?: unknown;
  cover_recipe?: unknown;
}

/**
 * The ONE way a profile photo is uploaded (Nov 2 2026, SCALE_AUDIT hole #9):
 * the render and the kept original each go intent → a signed PUT straight
 * to storage (upload.ts stageUpload — no Vercel function ever carries the
 * bytes, so the 4 MB request budget is gone), then one JSON POST to
 * /api/profile/photo finalizes both to the slot's paths and writes the row.
 * Throws an Error with the sentence to show.
 */
export async function uploadProfilePhoto(slot: ProfilePhotoSlot, payload: ProfilePhotoPayload, targetProfileId?: string | null): Promise<ProfilePhotoAnswer> {
  const target = targetProfileId ?? undefined;
  const render = await stageUpload(payload.file, target);
  let sourcePath: string | null = null;
  if (!payload.sameSource && payload.source) {
    try {
      sourcePath = (await stageUpload(payload.source, target)).path;
    } catch (err) {
      // The render is what the profile shows; a lost original only means Adjust starts from the render.
      console.warn('[profile photo] the original did not upload; keeping the photo alone:', err);
    }
  }
  const response = await fetch('/api/profile/photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slot,
      path: render.path,
      ...(sourcePath ? { sourcePath } : {}),
      ...(payload.sameSource ? { sameSource: true } : {}),
      ...(payload.recipe ? { recipe: { v: 3, recipe: payload.recipe } } : {}),
      ...(target ? { targetProfileId: target } : {}),
    }),
  });
  const data = (await response.json().catch(() => ({}))) as Partial<ProfilePhotoAnswer> & { error?: string };
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || `Failed to upload the ${slot === 'avatar' ? 'profile photo' : 'cover photo'}`);
  }
  return data as ProfilePhotoAnswer;
}

/**
 * The editor asset for Adjust: the kept original (through the owner-only
 * proxy) at its stored crop — or, for a photo with no original, the render
 * itself with no recipe (lossy exactly once: Done sends that render as the
 * new original).
 */
export async function assetFromProfilePhoto(id: string, url: string, recipe: ImageRecipe | null): Promise<MediaAsset> {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the photo');
  const blob = await res.blob();
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
  const file = new File([blob], `current.${ext}`, { type });
  return { id, file, kind: 'image', recipe: recipe ?? undefined };
}
