// ── Profile photos on the device (PR 5, Oct 14 2026) — browser-only ──────────
// The three things a profile photo needs before its POST, beside the pure
// rules in photo-recipe.ts: the kept original bounded for upload, the
// request body, and the editor asset that Adjust opens.

import type { ImageRecipe, MediaAsset } from '@/lib/media/types';
import { PROFILE_SOURCE_MAX_DIM, type ProfilePhotoPayload } from './photo-recipe';
import type { ProfilePhotoSlot } from './photo-paths';

const KEEP_AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The original to keep: the file itself when it is a JPEG / PNG / WebP within
 * PROFILE_SOURCE_MAX_DIM, else a JPEG re-encode bounded to it (a HEIC, a GIF,
 * a 12 MP capture). Never throws: null means "keep no original" — the render
 * uploads alone, and Adjust starts from it.
 */
export async function prepareProfileSource(file: File): Promise<File | null> {
  try {
    const { probeImageDims } = await import('@/lib/media/probe');
    const dims = await probeImageDims(file);
    if (KEEP_AS_IS.has(file.type) && dims && Math.max(dims.width, dims.height) <= PROFILE_SOURCE_MAX_DIM) return file;
    const [{ renderImage }, { defaultImageRecipe }] = await Promise.all([import('@/lib/media/render'), import('@/lib/media/recipes')]);
    const blob = await renderImage(file, defaultImageRecipe(), { maxDimension: PROFILE_SOURCE_MAX_DIM, mime: 'image/jpeg', quality: 0.9 });
    return new File([blob], 'original.jpg', { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[profile photo] could not prepare the original; uploading the render alone:', err);
    return null;
  }
}

/** The ONE request body both photo routes read (photo-source-server.ts readPhotoPostFields). */
export function profilePhotoFormData(slot: ProfilePhotoSlot, payload: ProfilePhotoPayload, targetProfileId?: string | null): FormData {
  const formData = new FormData();
  formData.append(slot, payload.file);
  if (payload.sameSource) formData.append('sameSource', '1');
  else if (payload.source) formData.append('source', payload.source);
  if (payload.recipe) formData.append('recipe', JSON.stringify({ v: 3, recipe: payload.recipe }));
  if (targetProfileId) formData.append('targetProfileId', targetProfileId);
  return formData;
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
