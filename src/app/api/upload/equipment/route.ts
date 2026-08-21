import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { enforceRateLimit } from '@/lib/rate-limit';

/**
 * POST /api/upload/equipment — photo for an athlete_equipment row.
 *
 * Follows the cover route's pattern: field `image`, image-only (allowlist
 * shared with the client via lib/media/validation), 5MB, fixed `uploads`
 * bucket at equipment/{userId}/….
 *
 * WHY THIS EXISTS: EquipmentImageUpload used to upload straight from the
 * browser to a bucket named `media`, which does not exist in this project
 * (the buckets are avatars, badges, uploads, consent-evidence) — so every
 * equipment photo upload failed with "Bucket not found". Going through a
 * route also puts the size/MIME check on the server instead of trusting the
 * client-side validateFiles call.
 *
 * Unlike the avatar/cover routes this writes no DB column: the modal holds
 * the returned URL and saves it with the rest of the equipment row (or
 * discards it if the user cancels). An abandoned upload is therefore a real
 * orphan — collected by the storage sweep after its 48h grace, since
 * athlete_equipment.image_url is one of the scanned URL_SOURCE_COLUMNS.
 */

const MAX_EQUIPMENT_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const supabase = getSupabaseAdmin();

    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_EQUIPMENT_BYTES) {
      return NextResponse.json({ error: 'Image must be less than 5MB' }, { status: 400 });
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        { error: 'Please select a valid image file (JPG, PNG, GIF, or WebP)' },
        { status: 400 }
      );
    }

    const ext =
      file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp'
      : file.type === 'image/gif' ? 'gif'
      : 'jpg';
    const filePath = `equipment/${user.id}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (uploadError) {
      console.error('Equipment image upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(filePath);
    const imageUrl = urlData?.publicUrl;
    if (!imageUrl) {
      await supabase.storage.from('uploads').remove([filePath]);
      return NextResponse.json({ error: 'Failed to get image URL' }, { status: 500 });
    }

    // Round H: equipment photos are the one image path that skips the
    // approval queue (post media is held; these attach straight to gear on
    // the public profile). Visibility + veto: a supervised upload bells the
    // guardians, who can review the profile. Best-effort.
    const { data: uploader } = await supabase
      .from('profiles')
      .select('supervision_state, first_name')
      .eq('id', user.id)
      .maybeSingle();
    if (uploader?.supervision_state === 'supervised') {
      const { notifyGuardians } = await import('@/lib/guardian-notify');
      await notifyGuardians(supabase, user.id, {
        type: 'safety_alert',
        title: `${uploader.first_name || 'Your athlete'} uploaded an equipment photo`,
        actionUrl: `/athlete/${user.id}`,
        actorId: user.id,
        metadata: { image_url: imageUrl },
      }, user.id);
    }

    return NextResponse.json({ success: true, image_url: imageUrl });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Equipment image upload error:', error);
    return NextResponse.json({ error: 'Failed to upload image' }, { status: 500 });
  }
}
