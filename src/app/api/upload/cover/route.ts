import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { prepareImage } from '@/lib/media/image-meta';
import { managedProfilePhotoPath } from '@/lib/profiles/photo-paths';

/**
 * POST /api/upload/cover — profile cover/banner image.
 *
 * The avatar route's PATTERN without its legacy debt (no bucket-guessing
 * loop): field `cover`, image-only (allowlist shared with the client via
 * lib/media/validation), 10MB, fixed `uploads` bucket at covers/{userId}/…,
 * updates profiles.cover_url, rolls the upload back on DB failure, and
 * best-effort deletes the previous cover file.
 */

const MAX_COVER_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();

    const formData = await request.formData();
    const file = formData.get('cover') as File | null;
    // A guardian may set their supervised athlete's cover (the avatar route's
    // acting gate; Oct 14 2026) — the row written is the ACTOR's.
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

    // The bytes must BE the declared image; location metadata leaves on the
    // server too (image-meta.ts — the device strip is no longer the only one).
    const prepared = prepareImage(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

    // Previous cover path (deleted after a successful swap)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('cover_url')
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

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ cover_url: coverUrl })
      .eq('id', userId);
    if (updateError) {
      // Roll the orphan back — the profile still points at the old cover
      await supabase.storage.from('uploads').remove([filePath]);
      reportRouteError('Cover profile update error:', updateError);
      return NextResponse.json({ error: 'Failed to save cover image' }, { status: 500 });
    }

    // Best-effort cleanup of the replaced file (only paths we manage)
    const previous = profileRow?.cover_url;
    if (previous) {
      const m = /\/storage\/v1\/object\/public\/uploads\/(covers\/.+)$/.exec(previous);
      if (m) {
        const { error: removeError } = await supabase.storage
          .from('uploads')
          .remove([decodeURIComponent(m[1])]);
        if (removeError) console.warn('Previous cover cleanup failed:', removeError);
      }
    }

    return NextResponse.json({ success: true, cover_url: coverUrl });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Cover upload error:', error);
    return NextResponse.json({ error: 'Failed to upload cover image' }, { status: 500 });
  }
}

/**
 * DELETE /api/upload/cover — remove the cover photo (profile quick fixes PR 4,
 * Oct 14 2026): the column goes NULL and the managed file (ours, under
 * covers/) is removed; the upload button returns. Body: { targetProfileId? }
 * — the same acting gate as the POST. Shares the POST's write gate.
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
    const userId = gate.actorId;

    const supabase = getSupabaseAdmin();
    const { data: current } = await supabase.from('profiles').select('cover_url').eq('id', userId).maybeSingle();
    const { error: updateError } = await supabase.from('profiles').update({ cover_url: null }).eq('id', userId);
    if (updateError) {
      reportRouteError('Cover remove error:', updateError);
      return NextResponse.json({ error: 'Failed to remove the cover photo' }, { status: 500 });
    }
    const managed = managedProfilePhotoPath(current?.cover_url, 'cover');
    if (managed) {
      const { error: removeError } = await supabase.storage.from(managed.bucket).remove([managed.path]);
      if (removeError) console.warn('Cover removal: file cleanup failed:', removeError);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Cover remove error:', error);
    return NextResponse.json({ error: 'Failed to remove the cover photo' }, { status: 500 });
  }
}
