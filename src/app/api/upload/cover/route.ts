import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { prepareImage } from '@/lib/media/image-meta';
import { readPhotoPostFields, removeProfilePhoto, storeProfilePhoto } from '@/lib/profiles/photo-source-server';

/**
 * POST /api/upload/cover — profile cover/banner image.
 *
 * The avatar route's PATTERN without its legacy debt (no bucket-guessing
 * loop): field `cover` (the DERIVED 3:1 render), image-only (allowlist shared
 * with the client via lib/media/validation), 10MB, fixed `uploads` bucket at
 * covers/{userId}/…. Beside it, since PR 5 (Oct 14 2026, migration 264):
 * `source` (the kept original), `recipe` (the crop that made the render) and
 * `sameSource=1` (Adjust — keep the stored original); the row and the
 * cleanup are photo-source-server.ts's. A guardian may act for a supervised
 * athlete through `targetProfileId` (the acting gate; the row written is the
 * ACTOR's).
 */

const MAX_COVER_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'upload' }); // 286
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();

    const formData = await request.formData();
    const file = formData.get('cover') as File | null;
    const targetProfileId = formData.get('targetProfileId');
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(user.id, typeof targetProfileId === 'string' ? targetProfileId : null, 'You do not have permission to change this profile');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const userId = gate.actorId;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_COVER_BYTES) {
      return NextResponse.json({ error: 'Cover image must be less than 10MB' }, { status: 400 });
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        { error: 'Please select a valid image file (JPG, PNG, GIF, or WebP)' },
        { status: 400 }
      );
    }
    const fields = readPhotoPostFields(formData);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });

    // The bytes must BE the declared image; location metadata leaves on the
    // server too (image-meta.ts — the device strip is no longer the only one).
    const prepared = prepareImage(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

    // What the row names today (deleted after a successful swap)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('cover_url, cover_source_url')
      .eq('id', userId)
      .single();

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
    const filePath = `covers/${userId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, prepared.bytes, { contentType: file.type, cacheControl: '3600', upsert: false });
    if (uploadError) {
      reportRouteError('Cover upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload cover image' }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const coverUrl = urlData?.publicUrl;
    if (!coverUrl) {
      await supabase.storage.from('uploads').remove([filePath]);
      return NextResponse.json({ error: 'Failed to get cover URL' }, { status: 500 });
    }

    const stored = await storeProfilePhoto(supabase, {
      profileId: userId,
      slot: 'cover',
      derived: { bucket: 'uploads', path: filePath, url: coverUrl },
      fields: fields.fields,
      previous: { url: profileRow?.cover_url ?? null, sourceUrl: profileRow?.cover_source_url ?? null },
    });
    if (!stored.ok) {
      if (stored.status === 500) reportRouteError('Cover profile update error:', stored.detail ?? stored.error);
      return NextResponse.json({ error: stored.error }, { status: stored.status });
    }

    return NextResponse.json({ success: true, cover_url: coverUrl, cover_source_url: stored.sourceUrl, cover_recipe: stored.recipe });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Cover upload error:', error);
    return NextResponse.json({ error: 'Failed to upload cover image' }, { status: 500 });
  }
}

/**
 * DELETE /api/upload/cover — remove the cover photo (profile quick fixes PR 4,
 * Oct 14 2026): the column goes NULL and the managed file (ours, under
 * covers/) is removed — and, since PR 5, the kept original and its recipe
 * with it; the upload button returns. Body: { targetProfileId? } — the same
 * acting gate as the POST. Shares the POST's write gate.
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'upload' }); // 286
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;
    let body: { targetProfileId?: unknown } = {};
    try { body = await request.json(); } catch { /* an empty body is fine */ }
    const { resolveActingProfile } = await import('@/lib/guardian-gate');
    const gate = await resolveActingProfile(user.id, typeof body.targetProfileId === 'string' ? body.targetProfileId : null, 'You do not have permission to change this profile');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const removed = await removeProfilePhoto(getSupabaseAdmin(), gate.actorId, 'cover');
    if (!removed.ok) {
      reportRouteError('Cover remove error:', removed.error);
      return NextResponse.json({ error: 'Failed to remove the cover photo' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Cover remove error:', error);
    return NextResponse.json({ error: 'Failed to remove the cover photo' }, { status: 500 });
  }
}
