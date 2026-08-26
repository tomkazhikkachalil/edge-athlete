import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';

// Server is the security boundary: explicit allowlist (no SVG — it can carry
// scripts and this URL is rendered across the app), extensions derived from
// the MIME type rather than trusting the client filename.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(request: NextRequest) {
  try {
    // Auth required — the avatar is always written to the session user's
    // profile, never a body-supplied userId (that let anyone overwrite any
    // user's avatar).
    const user = await requireAuth(request);
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
      console.error('Avatar API: No file provided');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type against the allowlist
    const fileExt = ALLOWED_IMAGE_TYPES[file.type];
    if (!fileExt) {
      console.error('Avatar API: Invalid file type:', file.type);
      return NextResponse.json({ error: 'File must be a JPEG, PNG, WebP, or GIF image' }, { status: 400 });
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      console.error('Avatar API: File too large:', file.size, 'bytes');
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      console.error('Avatar API: supabaseAdmin not available');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Remember the previous avatar so we can clean it up after a successful
    // swap (every upload used to orphan the prior file forever).
    const { data: currentProfile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .maybeSingle();
    const previousAvatarUrl: string | null = currentProfile?.avatar_url || null;

    const fileName = `avatar-${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

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
      console.error('Avatar API: All buckets failed, last error:', uploadError);
      return NextResponse.json({ error: 'Avatar upload failed' }, { status: 500 });
    }

    // Get public URL using the successful bucket
    const { data: publicUrl } = supabaseAdmin.storage
      .from(successBucket)
      .getPublicUrl(filePath);

    if (!publicUrl?.publicUrl) {
      console.error('Avatar API: Failed to get public URL');
      return NextResponse.json({ error: 'Failed to get public URL' }, { status: 500 });
    }

    // Update profile with new avatar URL. A DB failure here is a REAL
    // failure — returning success anyway left the UI showing the old avatar
    // with no error (and an orphaned upload).
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: publicUrl.publicUrl })
      .eq('id', userId);

    if (updateError) {
      console.error('Avatar API: Profile update error:', updateError);
      // Best effort: remove the just-uploaded file so it doesn't orphan
      await supabaseAdmin.storage.from(successBucket).remove([filePath]);
      return NextResponse.json({ error: 'Failed to update profile with new avatar' }, { status: 500 });
    }

    // Best-effort cleanup of the previous avatar file (only files we manage:
    // same bucket, avatars/ prefix — never touch external URLs).
    if (previousAvatarUrl && previousAvatarUrl !== publicUrl.publicUrl) {
      try {
        const marker = `/storage/v1/object/public/${successBucket}/`;
        const idx = previousAvatarUrl.indexOf(marker);
        if (idx !== -1) {
          const oldPath = decodeURIComponent(previousAvatarUrl.slice(idx + marker.length));
          if (oldPath.startsWith('avatars/')) {
            await supabaseAdmin.storage.from(successBucket).remove([oldPath]);
          }
        }
      } catch (cleanupError) {
        // Non-fatal — worst case the old file is orphaned, as before
        console.warn('Avatar API: old avatar cleanup failed:', cleanupError);
      }
    }

    return NextResponse.json({
      success: true,
      avatar_url: publicUrl.publicUrl,
      message: 'Avatar uploaded successfully'
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Avatar API: Unexpected error:', error);
    console.error('Avatar API: Error details:', error instanceof Error ? error.stack : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
