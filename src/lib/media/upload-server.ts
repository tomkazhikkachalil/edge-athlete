/**
 * Direct-to-storage upload, the server half (Oct 2026). The rules live in
 * upload-rules.ts (pure); this module is the two storage acts the routes run:
 * sign an `incoming/` key, and finalize it into `posts/`.
 *
 * Finalize never trusts the client's word about the bytes: the stored
 * object's own size and content type are read back (a listing — no download)
 * and must match what intent minted. A video is then downloaded, scrubbed of
 * its metadata (GPS) by the same `scrubVideoMetadata` the old door used, and
 * written to `posts/`; everything else is MOVED there server-side (no bytes
 * through the function). Fail-open on the scrub, exactly like the old door:
 * an upload never dies in the scrubber.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { scrubVideoMetadata, SCRUBBABLE_VIDEO } from './video-scrub-server';
import {
  incomingKey,
  MAX_UPLOAD_BYTES,
  parseIncomingKey,
  postsKey,
  storedTypeMatches,
  uploadKindOf,
} from './upload-rules';

const BUCKET = 'uploads';

export async function signIncomingUpload(
  admin: SupabaseClient,
  ownerId: string,
  type: string
): Promise<{ path: string; signedUrl: string; token: string }> {
  const path = incomingKey(ownerId, type, crypto.randomUUID());
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error('createSignedUploadUrl returned nothing');
  return { path, signedUrl: data.signedUrl, token: data.token };
}

export type FinalizeResult =
  | { ok: true; url: string; type: 'image' | 'video'; scrubbed: boolean }
  | { ok: false; status: 400 | 404 | 413 | 500; error: string };

async function storedObjectInfo(
  admin: SupabaseClient,
  path: string
): Promise<{ size: number; mimetype: string | null } | null> {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 10 });
  if (error || !data) return null;
  const hit = data.find(f => f.name === name);
  if (!hit) return null;
  const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
  return { size: typeof meta.size === 'number' ? meta.size : NaN, mimetype: meta.mimetype ?? null };
}

async function discard(admin: SupabaseClient, path: string) {
  await admin.storage.from(BUCKET).remove([path]).then(
    () => undefined,
    () => undefined
  );
}

export async function finalizeIncomingUpload(
  admin: SupabaseClient,
  ownerId: string,
  incomingPath: unknown
): Promise<FinalizeResult> {
  const parsed = parseIncomingKey(incomingPath, ownerId);
  if (!parsed) return { ok: false, status: 400, error: 'Unknown upload' };
  const path = incomingPath as string;
  const kind = uploadKindOf(parsed.type);
  if (!kind) return { ok: false, status: 400, error: 'Unknown upload' };

  const info = await storedObjectInfo(admin, path);
  if (!info) return { ok: false, status: 404, error: 'The upload did not arrive — please try again' };
  if (!(info.size > 0) || info.size > MAX_UPLOAD_BYTES) {
    await discard(admin, path);
    return { ok: false, status: 413, error: `File size must be less than ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` };
  }
  if (!storedTypeMatches(parsed.type, info.mimetype)) {
    await discard(admin, path);
    return { ok: false, status: 400, error: 'The file type did not match the upload' };
  }

  let finalExt = parsed.ext;
  let scrubbed = false;

  if (kind === 'video' && SCRUBBABLE_VIDEO.has(parsed.type)) {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
    if (!error && blob) {
      const result = await scrubVideoMetadata(new Uint8Array(await blob.arrayBuffer()), parsed.type);
      if (result.scrubbed) {
        finalExt = 'mp4'; // a scrubbed MOV becomes an MP4 — the key follows the OUTPUT
        const target = postsKey(ownerId, parsed.id, finalExt);
        const { error: writeError } = await admin.storage
          .from(BUCKET)
          .upload(target, new Blob([result.bytes as BlobPart], { type: result.mime }), {
            contentType: result.mime,
            cacheControl: '3600',
            upsert: false,
          });
        if (!writeError) {
          scrubbed = true;
          await discard(admin, path);
          return { ok: true, url: publicUrl(admin, target), type: kind, scrubbed };
        }
        console.warn('[upload] scrubbed write failed; keeping the original:', writeError);
        finalExt = parsed.ext;
      }
    } else {
      console.warn('[upload] could not read the upload back for the scrub; storing as-is:', error);
    }
  }

  // Not scrubbed (an image, a webm, or a fail-open scrub): a server-side move.
  const target = postsKey(ownerId, parsed.id, finalExt);
  const { error: moveError } = await admin.storage.from(BUCKET).move(path, target);
  if (moveError) return { ok: false, status: 500, error: 'Failed to upload file' };
  return { ok: true, url: publicUrl(admin, target), type: kind, scrubbed };
}

function publicUrl(admin: SupabaseClient, path: string): string {
  // The same URL shape the old door returned; proxy-url.ts rewrites it for viewers.
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
