import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { enforceRateLimit } from '@/lib/rate-limit';

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
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();

    const formData = await request.formData();
    const file = formData.get('cover') as File | null;
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

    // Previous cover path (deleted after a successful swap)
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('cover_url')
      .eq('id', user.id)
      .single();

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
    const filePath = `covers/${user.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) {
      console.error('Cover upload error:', uploadError);
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
      .eq('id', user.id);
    if (updateError) {
      // Roll the orphan back — the profile still points at the old cover
      await supabase.storage.from('uploads').remove([filePath]);
      console.error('Cover profile update error:', updateError);
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
    console.error('Cover upload error:', error);
    return NextResponse.json({ error: 'Failed to upload cover image' }, { status: 500 });
  }
}
