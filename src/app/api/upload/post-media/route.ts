import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    // Require authentication
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;


    const formData = await request.formData();
    const file = formData.get('file') as File;
    // Owner defaults to the authenticated session. A guardian uploading for
    // a managed athlete passes targetProfileId, validated by the SAME gate
    // the content routes use — before this, acting-as media landed under the
    // GUARDIAN's storage prefix, mis-attributing the child's bytes to the
    // guardian for DELETE ownership, sweeps, and account deletion.
    const rawTarget = formData.get('targetProfileId');
    const targetProfileId = typeof rawTarget === 'string' && rawTarget ? rawTarget : null;
    const gate = await resolveActingProfile(
      user.id,
      targetProfileId,
      'Only a guardian may upload media for this profile.'
    );
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const userId = gate.actorId;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // File validation. Extension is derived from the VALIDATED MIME type, never
    // the client filename — file.name is attacker-controlled: a '/' in it would
    // write to an arbitrary sub-path, and an unvalidated extension mislabels
    // the stored object (upload/route.ts already does it this way).
    const maxSize = 50 * 1024 * 1024; // 50MB
    const EXT_BY_TYPE: Record<string, string> = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
      'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    };
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size must be less than 50MB' }, { status: 400 });
    }

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({
        error: 'Please select a valid image or video file (JPG, PNG, GIF, WebP, MP4, MOV, WebM)'
      }, { status: 400 });
    }

    // Generate unique filename — extension from the validated type, random
    // name (crypto.randomUUID, same as upload/route.ts) so nothing in the key
    // is caller-controlled.
    const fileExt = EXT_BY_TYPE[file.type];
    const fileName = `${userId}/${crypto.randomUUID()}.${fileExt}`;
    const filePath = `posts/${fileName}`;

    // Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      return NextResponse.json({ error: 'Failed to get file URL' }, { status: 500 });
    }

    // Return simplified response that matches what modal expects
    return NextResponse.json({
      url: urlData.publicUrl,
      type: allowedImageTypes.includes(file.type) ? 'image' : 'video'
    });

  } catch (error) {
    console.error('File upload error:', error);

    if (error instanceof Response) {
      return error;
    }

    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Auth required — derive the owner from the session, not the query string.
    // Previously any caller could delete another user's media by passing a
    // matching filePath + userId.
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('filePath');
    const userId = user.id;

    if (!filePath) {
      return NextResponse.json({ error: 'File path is required' }, { status: 400 });
    }

    // Verify the file belongs to the session user — or to a profile the
    // session user guards (acting-as uploads are keyed to the CHILD's
    // prefix, so the guardian who just uploaded must be able to undo it).
    if (!filePath.includes(`posts/${userId}/`)) {
      const m = filePath.match(/posts\/([0-9a-f-]{36})\//);
      const prefixOwner = m && isUuid(m[1]) ? m[1] : null;
      const role = prefixOwner ? await getProfileRole(userId, prefixOwner) : null;
      if (role !== 'guardian') {
        return NextResponse.json({ error: 'Unauthorized file access' }, { status: 403 });
      }
    }

    // Delete file from Supabase Storage
    const { error: deleteError } = await supabase.storage
      .from('uploads')
      .remove([filePath.replace(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/`, '')]);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully!'
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('File delete error:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}