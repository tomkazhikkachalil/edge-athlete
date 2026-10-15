// ── The kept original behind a profile photo: the ONE server writer (PR 5,
// Oct 14 2026, migration 264) ─────────────────────────────────────────────────
// Both photo routes (avatar, cover) upload their DERIVED render themselves
// (their own prefixes, registered in storage-sweep.test.ts) and hand the rest
// here: the original's upload under profile-sources/{profile}/ in the private
// uploads bucket, the row (the derived URL, the source URL, the recipe
// envelope), and the cleanup of what the row no longer names. Never throws
// on cleanup; a row failure rolls the uploads back and reports.

import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareImage } from '@/lib/media/image-meta';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import type { ImageRecipe } from '@/lib/media/types';
import { managedProfilePhotoPath, managedProfileSourcePath, PROFILE_SOURCE_BUCKET, type ProfilePhotoSlot } from './photo-paths';
import { parseProfilePhotoRecipe, profilePhotoRecipeEnvelope, profileSourcePath } from './photo-recipe';

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export interface PhotoPostFields {
  /** The original to keep (bounded on the device), or null. */
  source: File | null;
  /** The crop that made the derived file (the editor envelope, JSON). */
  recipe: ImageRecipe | null;
  /** Adjust: keep the stored original. */
  sameSource: boolean;
}

/** The optional fields of a photo POST, read once, refused by name. */
export function readPhotoPostFields(formData: FormData): { ok: true; fields: PhotoPostFields } | { ok: false; error: string } {
  const rawSource = formData.get('source');
  const source = rawSource instanceof File && rawSource.size > 0 ? rawSource : null;
  if (source) {
    if (source.size > MAX_SOURCE_BYTES) return { ok: false, error: 'The original photo must be less than 10MB' };
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(source.type)) return { ok: false, error: 'The original must be a JPG, PNG, GIF or WebP image' };
  }
  const rawRecipe = formData.get('recipe');
  let recipe: ImageRecipe | null = null;
  if (typeof rawRecipe === 'string' && rawRecipe.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawRecipe);
    } catch {
      return { ok: false, error: 'recipe is not valid JSON' };
    }
    recipe = parseProfilePhotoRecipe(parsed);
    if (!recipe) return { ok: false, error: 'recipe is not an image recipe' };
  }
  const sameSource = formData.get('sameSource') === '1';
  if (sameSource && source) return { ok: false, error: 'sameSource and a new source cannot both be sent' };
  return { ok: true, fields: { source, recipe, sameSource } };
}

export interface PreviousPhoto {
  url: string | null;
  sourceUrl: string | null;
}

export interface StoreProfilePhotoInput {
  profileId: string;
  slot: ProfilePhotoSlot;
  /** The derived file the route already uploaded. */
  derived: { bucket: string; path: string; url: string };
  fields: PhotoPostFields;
  previous: PreviousPhoto;
  now?: number;
}

export type StoreProfilePhotoResult =
  | { ok: true; sourceUrl: string | null; recipe: { v: 3; recipe: ImageRecipe } | null }
  | { ok: false; status: 400 | 500; error: string; detail?: unknown };

/**
 * Writes the row for a slot: the derived URL always; the source + recipe
 * when an original arrived; the recipe alone under sameSource (the stored
 * original stays — 400 when there is none); both NULL otherwise (an old
 * client, onboarding's plain upload — Adjust then starts from the render).
 * On a row failure every upload of this call is removed. Afterwards the
 * previous derived file goes, and the previous original unless kept.
 */
export async function storeProfilePhoto(admin: SupabaseClient, input: StoreProfilePhotoInput): Promise<StoreProfilePhotoResult> {
  const { profileId, slot, derived, fields, previous } = input;
  const urlKey = `${slot}_url`;
  const sourceKey = `${slot}_source_url`;
  const recipeKey = `${slot}_recipe`;
  const rollback: Array<{ bucket: string; path: string }> = [{ bucket: derived.bucket, path: derived.path }];

  const patch: Record<string, unknown> = { [urlKey]: derived.url };
  let sourceUrl: string | null = null;
  let envelope: { v: 3; recipe: ImageRecipe } | null = null;

  if (fields.sameSource) {
    if (!previous.sourceUrl) {
      await admin.storage.from(derived.bucket).remove([derived.path]).catch(() => undefined);
      return { ok: false, status: 400, error: 'There is no stored original to keep — send the photo again' };
    }
    sourceUrl = previous.sourceUrl;
    envelope = fields.recipe ? profilePhotoRecipeEnvelope(fields.recipe) : null;
    patch[recipeKey] = envelope;
  } else if (fields.source) {
    const prepared = prepareImage(new Uint8Array(await fields.source.arrayBuffer()), fields.source.type);
    if (!prepared.ok) {
      await admin.storage.from(derived.bucket).remove([derived.path]).catch(() => undefined);
      return { ok: false, status: 400, error: prepared.error };
    }
    const ext = fields.source.type === 'image/png' ? 'png' : fields.source.type === 'image/webp' ? 'webp' : fields.source.type === 'image/gif' ? 'gif' : 'jpg';
    const path = profileSourcePath(profileId, slot, input.now ?? Date.now(), ext);
    const { error: uploadError } = await admin.storage
      .from(PROFILE_SOURCE_BUCKET)
      .upload(path, prepared.bytes, { contentType: fields.source.type, cacheControl: '3600', upsert: false });
    if (uploadError) {
      await admin.storage.from(derived.bucket).remove([derived.path]).catch(() => undefined);
      return { ok: false, status: 500, error: 'Failed to keep the original photo', detail: uploadError };
    }
    rollback.push({ bucket: PROFILE_SOURCE_BUCKET, path });
    sourceUrl = admin.storage.from(PROFILE_SOURCE_BUCKET).getPublicUrl(path).data?.publicUrl ?? null;
    envelope = fields.recipe ? profilePhotoRecipeEnvelope(fields.recipe) : null;
    patch[sourceKey] = sourceUrl;
    patch[recipeKey] = envelope;
  } else {
    patch[sourceKey] = null;
    patch[recipeKey] = null;
  }

  const { error: updateError } = await admin.from('profiles').update(patch).eq('id', profileId);
  if (updateError) {
    for (const r of rollback) await admin.storage.from(r.bucket).remove([r.path]).catch(() => undefined);
    return { ok: false, status: 500, error: 'Failed to save the photo', detail: updateError };
  }

  // Best-effort cleanup of what the row no longer names (ours only).
  const oldDerived = managedProfilePhotoPath(previous.url, slot);
  if (oldDerived && !(oldDerived.bucket === derived.bucket && oldDerived.path === derived.path)) {
    const { error } = await admin.storage.from(oldDerived.bucket).remove([oldDerived.path]);
    if (error) console.warn(`Previous ${slot} cleanup failed:`, error);
  }
  if (!fields.sameSource) {
    const oldSource = managedProfileSourcePath(previous.sourceUrl);
    if (oldSource) {
      const { error } = await admin.storage.from(oldSource.bucket).remove([oldSource.path]);
      if (error) console.warn(`Previous ${slot} original cleanup failed:`, error);
    }
  }
  return { ok: true, sourceUrl, recipe: envelope };
}

/**
 * Remove a slot: the three columns NULL, then OUR files (the derived, the
 * original) — the DELETE routes' shared body.
 */
export async function removeProfilePhoto(
  admin: SupabaseClient,
  profileId: string,
  slot: ProfilePhotoSlot
): Promise<{ ok: true; previous: PreviousPhoto & { handle: string | null } } | { ok: false; error: unknown }> {
  const { data: current } = await admin
    .from('profiles')
    .select(`${slot}_url, ${slot}_source_url, handle`)
    .eq('id', profileId)
    .maybeSingle();
  const row = (current ?? {}) as Record<string, unknown>;
  const previous = {
    url: (row[`${slot}_url`] as string | null) ?? null,
    sourceUrl: (row[`${slot}_source_url`] as string | null) ?? null,
    handle: (row.handle as string | null) ?? null,
  };
  const { error } = await admin
    .from('profiles')
    .update({ [`${slot}_url`]: null, [`${slot}_source_url`]: null, [`${slot}_recipe`]: null })
    .eq('id', profileId);
  if (error) return { ok: false, error };
  const files = [managedProfilePhotoPath(previous.url, slot), managedProfileSourcePath(previous.sourceUrl)];
  for (const f of files) {
    if (!f) continue;
    const { error: removeError } = await admin.storage.from(f.bucket).remove([f.path]);
    if (removeError) console.warn(`${slot} removal: file cleanup failed:`, removeError);
  }
  return { ok: true, previous };
}
