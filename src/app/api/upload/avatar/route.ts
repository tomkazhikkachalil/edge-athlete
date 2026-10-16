import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { revalidatePublicHead } from '@/lib/profiles/public-head';
import { prepareImage } from '@/lib/media/image-meta';
import { readPhotoPostFields, removeProfilePhoto, storeProfilePhoto } from '@/lib/profiles/photo-source-server';

// Server is the security boundary: explicit allowlist (no SVG — it can carry
// scripts and this URL is rendered across the app), extensions derived from
// the MIME type rather than trusting the client filename.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * POST /api/upload/avatar — field `avatar` (the DERIVED round render, ≤1024 px).
 * Beside it, since PR 5 (Oct 14 2026, migration 264): `source` (the kept
 * original), `recipe` (the crop that made the render) and `sameSource=1`
 * (Adjust — keep the stored original); the row and the cleanup are
 * photo-source-server.ts's.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth required — the avatar is always written to the session user's
    // profile, never a body-supplied userId (that let anyone overwrite any
    // user's avatar).
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;


    const formData = await request.formData();
    const file = formData.get('avatar') as File;

    // Acting-as (Round C): a guardian may set their managed athlete's
    // avatar (children created via the console have none, and can't take
    // their own). Round F: the hand-rolled gate here skipped the consent
    // check the other acting-as writes enforce — now the one shared gate.
    const targetProfileId = formData.get('targetProfileId');
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(
      user.id,
      typeof targetProfileId === 'string' ? targetProfileId : null,
      'You do not have permission to change this profile'
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const userId = gate.actorId;

    if (!file) {
      reportRouteError('Avatar API: No file provided');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type against the allowlist
    const fileExt = ALLOWED_IMAGE_TYPES[file.type];
    if (!fileExt) {
      reportRouteError('Avatar API: Invalid file type:', file.type);
      return NextResponse.json({ error: 'File must be a JPEG, PNG, WebP, or GIF image' }, { status: 400 });
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      reportRouteError('Avatar API: File too large:', file.size, 'bytes');
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 });
    }
    const fields = readPhotoPostFields(formData);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });

    const supabaseAdmin = getSupabaseAdmin();

    // Remember what the row names today so the swap can clean it up (every
    // upload used to orphan the prior file forever).
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url, avatar_source_url, handle')
      .eq('id', userId)
      .maybeSingle();

    const fileName = `avatar-${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // The bytes must BE the declared image; location metadata leaves on the
    // server too (image-meta.ts — the device strip is no longer the only one).
    const prepared = prepareImage(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
    const buffer = prepared.bytes;

    // Upload with the service-role client — storage writes should not depend
    // on the bucket accepting anonymous uploads. Try known bucket names.
    const bucketNames = ['avatars', 'uploads', 'images', 'files'];
    let uploadError: unknown = null;
    let successBucket = null;

    for (const bucketName of bucketNames) {
      const result = await supabaseAdmin.storage
        .from(bucketName)
        .upload(filePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (!result.error) {
        successBucket = bucketName;
        break;
      } else {
        uploadError = result.error;
      }
    }

    if (!successBucket) {
      reportRouteError('Avatar API: All buckets failed, last error:', uploadError);
      return NextResponse.json({ error: 'Avatar upload failed' }, { status: 500 });
    }

    // Get public URL using the successful bucket
    const { data: publicUrl } = supabaseAdmin.storage
      .from(successBucket)
      .getPublicUrl(filePath);

    if (!publicUrl?.publicUrl) {
      reportRouteError('Avatar API: Failed to get public URL');
      await supabaseAdmin.storage.from(successBucket).remove([filePath]);
      return NextResponse.json({ error: 'Failed to get public URL' }, { status: 500 });
    }

    // The row + the kept original + the cleanup. A DB failure here is a REAL
    // failure — returning success anyway left the UI showing the old avatar
    // with no error (and an orphaned upload); the writer rolls the uploads back.
    const stored = await storeProfilePhoto(supabaseAdmin, {
      profileId: userId,
      slot: 'avatar',
      derived: { bucket: successBucket, path: filePath, url: publicUrl.publicUrl },
      fields: fields.fields,
      previous: { url: currentProfile?.avatar_url ?? null, sourceUrl: currentProfile?.avatar_source_url ?? null },
    });
    if (!stored.ok) {
      if (stored.status === 500) reportRouteError('Avatar API: Profile update error:', stored.detail ?? stored.error);
      return NextResponse.json({ error: stored.error }, { status: stored.status });
    }

    // The avatar is the /u/ page's social image (cached per handle).
    revalidatePublicHead(currentProfile?.handle as string | null | undefined);

    return NextResponse.json({
      success: true,
      avatar_url: publicUrl.publicUrl,
      avatar_source_url: stored.sourceUrl,
      avatar_recipe: stored.recipe,
      message: 'Avatar uploaded successfully'
    });

  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Avatar API: Unexpected error:', error);
    reportRouteError('Avatar API: Error details:', error instanceof Error ? error.stack : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/upload/avatar — remove the profile picture (profile quick fixes
 * PR 4, Oct 14 2026): the column goes NULL, the managed file (ours, under
 * avatars/) is removed — and, since PR 5, the kept original and its recipe
 * with it — the /u/ head revalidates; the upload button returns.
 * Body: { targetProfileId? } — the same acting gate as the POST. Shares the
 * POST's write gate (this file is on THE list).
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    let body: { targetProfileId?: unknown } = {};
    try { body = await request.json(); } catch { /* an empty body is fine */ }
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(user.id, typeof body.targetProfileId === 'string' ? body.targetProfileId : null, 'You do not have permission to change this profile');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const removed = await removeProfilePhoto(getSupabaseAdmin(), gate.actorId, 'avatar');
    if (!removed.ok) {
      reportRouteError('Avatar API: remove failed:', removed.error);
      return NextResponse.json({ error: 'Failed to remove the profile picture' }, { status: 500 });
    }
    revalidatePublicHead(removed.previous.handle);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Avatar API: remove error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
